import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, count, eq } from "drizzle-orm";
import {
  router,
  projectMemberProcedure,
  projectAdminProcedure,
} from "../../trpc.js";
import { db } from "../../shared/db/postgres.js";
import { modelRates } from "../../shared/db/schema.js";
import { lookupRate } from "../../services/cost/rate-lookup.js";
import { normalizeModelName } from "../../shared/lib/model-normalization.js";

/**
 * tRPC router for the per-project model rate table.
 *
 * The rate table is populated lazily by the ingest pipeline as models are
 * seen in traces. This router exposes it to the UI: list, count unset
 * rows for the sidebar indicator, and let admins edit / reset / delete /
 * manually add rows.
 */

const rateFields = {
  inputPerMillionUsd: z.number().nonnegative(),
  outputPerMillionUsd: z.number().nonnegative(),
  cacheReadPerMillionUsd: z.number().nonnegative().nullable().optional(),
  cacheWritePerMillionUsd: z.number().nonnegative().nullable().optional(),
  reasoningPerMillionUsd: z.number().nonnegative().nullable().optional(),
};

export const modelRatesRouter = router({
  /**
   * List all rate rows for a project.
   *
   * Ordering is applied client-side by the UI (unset first, then user,
   * then litellm, alphabetical within each). Returning in a consistent
   * DB order keeps the query simple — the UI slice is small.
   */
  list: projectMemberProcedure.query(async ({ ctx }) => {
    const rows = await db
      .select()
      .from(modelRates)
      .where(eq(modelRates.projectId, ctx.projectId))
      .orderBy(modelRates.model);
    return rows.map((r) => ({
      id: r.id,
      model: r.model,
      provider: r.provider,
      inputPerMillionUsd: Number(r.inputPerMillionUsd),
      outputPerMillionUsd: Number(r.outputPerMillionUsd),
      cacheReadPerMillionUsd:
        r.cacheReadPerMillionUsd != null ? Number(r.cacheReadPerMillionUsd) : null,
      cacheWritePerMillionUsd:
        r.cacheWritePerMillionUsd != null ? Number(r.cacheWritePerMillionUsd) : null,
      reasoningPerMillionUsd:
        r.reasoningPerMillionUsd != null ? Number(r.reasoningPerMillionUsd) : null,
      source: r.source as "catalog" | "user" | "unset",
      updatedAt: r.updatedAt,
    }));
  }),

  /**
   * Count of `source='unset'` rows. Drives the sidebar red dot.
   * Kept as its own procedure so the sidebar can poll it cheaply
   * without fetching the full list.
   */
  unsetCount: projectMemberProcedure.query(async ({ ctx }) => {
    const [row] = await db
      .select({ n: count() })
      .from(modelRates)
      .where(
        and(
          eq(modelRates.projectId, ctx.projectId),
          eq(modelRates.source, "unset"),
        ),
      );
    return row?.n ?? 0;
  }),

  /**
   * Create or update a rate row with `source='user'`. Used by both the
   * edit modal and the "add custom model" modal. The model name is
   * normalized before storage so it matches whatever the ingest pipeline
   * will look up later.
   */
  upsert: projectAdminProcedure
    .input(
      z.object({
        projectId: z.string(),
        model: z.string().min(1).max(255),
        ...rateFields,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const normalized = normalizeModelName(input.model);
      if (!normalized) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid model name" });
      }

      const values = {
        projectId: ctx.projectId,
        model: normalized,
        provider: null,
        inputPerMillionUsd: input.inputPerMillionUsd.toString(),
        outputPerMillionUsd: input.outputPerMillionUsd.toString(),
        cacheReadPerMillionUsd:
          input.cacheReadPerMillionUsd != null
            ? input.cacheReadPerMillionUsd.toString()
            : null,
        cacheWritePerMillionUsd:
          input.cacheWritePerMillionUsd != null
            ? input.cacheWritePerMillionUsd.toString()
            : null,
        reasoningPerMillionUsd:
          input.reasoningPerMillionUsd != null
            ? input.reasoningPerMillionUsd.toString()
            : null,
        source: "user" as const,
      };

      await db
        .insert(modelRates)
        .values(values)
        .onConflictDoUpdate({
          target: [modelRates.projectId, modelRates.model],
          set: {
            inputPerMillionUsd: values.inputPerMillionUsd,
            outputPerMillionUsd: values.outputPerMillionUsd,
            cacheReadPerMillionUsd: values.cacheReadPerMillionUsd,
            cacheWritePerMillionUsd: values.cacheWritePerMillionUsd,
            reasoningPerMillionUsd: values.reasoningPerMillionUsd,
            source: "user",
            updatedAt: new Date(),
          },
        });

      return { ok: true as const };
    }),

  /**
   * Hard-delete a rate row. Next ingest of that model will re-populate
   * (via lookupRate) from the catalog or as an unset placeholder.
   */
  delete: projectAdminProcedure
    .input(z.object({ projectId: z.string(), rateId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [existing] = await db
        .select({ id: modelRates.id })
        .from(modelRates)
        .where(
          and(
            eq(modelRates.projectId, ctx.projectId),
            eq(modelRates.id, input.rateId),
          ),
        );
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Rate not found" });
      }
      await db
        .delete(modelRates)
        .where(eq(modelRates.id, input.rateId));
      return { ok: true as const };
    }),

  /**
   * Reset a user-edited rate to the LiteLLM catalog default.
   *
   * Implemented as "delete then re-lookup" so that `lookupRate` does all
   * the heavy lifting: if LiteLLM has the model, a fresh `source='litellm'`
   * row is inserted; if not, an `unset` placeholder is inserted.
   */
  resetToDefault: projectAdminProcedure
    .input(z.object({ projectId: z.string(), rateId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await db
        .select({ model: modelRates.model })
        .from(modelRates)
        .where(
          and(
            eq(modelRates.projectId, ctx.projectId),
            eq(modelRates.id, input.rateId),
          ),
        );
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Rate not found" });
      }

      await db
        .delete(modelRates)
        .where(
          and(
            eq(modelRates.projectId, ctx.projectId),
            eq(modelRates.id, input.rateId),
          ),
        );

      // Re-populate from catalog. Returns null if the model isn't in
      // LiteLLM — an `unset` placeholder was inserted instead.
      const rate = await lookupRate(ctx.projectId, row.model);
      return {
        restored: rate !== null,
      };
    }),
});
