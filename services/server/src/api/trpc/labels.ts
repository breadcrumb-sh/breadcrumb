import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  router,
  projectMemberProcedure,
  projectAdminProcedure,
} from "../../trpc.js";
import { db } from "../../shared/db/postgres.js";
import { monitorLabels, monitorItemLabels, monitorItems } from "../../shared/db/schema.js";

export const labelsRouter = router({
  list: projectMemberProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ input }) => {
      return db
        .select()
        .from(monitorLabels)
        .where(eq(monitorLabels.projectId, input.projectId));
    }),

  create: projectAdminProcedure
    .input(z.object({
      projectId: z.string(),
      name: z.string().min(1).max(64),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    }))
    .mutation(async ({ input }) => {
      const [label] = await db
        .insert(monitorLabels)
        .values({ projectId: input.projectId, name: input.name, color: input.color })
        .returning();
      return label;
    }),

  update: projectAdminProcedure
    .input(z.object({
      projectId: z.string(),
      id: z.string(),
      name: z.string().min(1).max(64).optional(),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, projectId, ...updates } = input;
      const [label] = await db
        .update(monitorLabels)
        .set(updates)
        .where(and(eq(monitorLabels.id, id), eq(monitorLabels.projectId, projectId)))
        .returning();
      if (!label) throw new TRPCError({ code: "NOT_FOUND" });
      return label;
    }),

  delete: projectAdminProcedure
    .input(z.object({ projectId: z.string(), id: z.string() }))
    .mutation(async ({ input }) => {
      await db
        .delete(monitorLabels)
        .where(and(eq(monitorLabels.id, input.id), eq(monitorLabels.projectId, input.projectId)));
    }),

  // ── Item label assignment ─────────────────────────────────────────

  listForItem: projectMemberProcedure
    .input(z.object({ projectId: z.string(), monitorItemId: z.string() }))
    .query(async ({ input }) => {
      const rows = await db
        .select({ label: monitorLabels })
        .from(monitorItemLabels)
        .innerJoin(monitorLabels, eq(monitorItemLabels.monitorLabelId, monitorLabels.id))
        .where(eq(monitorItemLabels.monitorItemId, input.monitorItemId));
      return rows.map((r) => r.label);
    }),

  setForItem: projectMemberProcedure
    .input(z.object({
      projectId: z.string(),
      monitorItemId: z.string(),
      labelIds: z.array(z.string()),
    }))
    .mutation(async ({ input }) => {
      // Verify item belongs to project
      const [item] = await db
        .select({ projectId: monitorItems.projectId })
        .from(monitorItems)
        .where(eq(monitorItems.id, input.monitorItemId));
      if (!item || item.projectId !== input.projectId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      // Replace all labels
      await db.delete(monitorItemLabels).where(eq(monitorItemLabels.monitorItemId, input.monitorItemId));
      if (input.labelIds.length > 0) {
        await db.insert(monitorItemLabels).values(
          input.labelIds.map((labelId) => ({
            monitorItemId: input.monitorItemId,
            monitorLabelId: labelId,
          })),
        );
      }
    }),
});
