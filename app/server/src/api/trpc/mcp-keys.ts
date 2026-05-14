import { z } from "zod";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure, memberInAnyOrgProcedure } from "../../trpc.js";
import { db } from "../../shared/db/postgres.js";
import { mcpKeys } from "../../shared/db/schema.js";
import {
  generateMcpKey,
  hashApiKey,
  getKeyPrefix,
} from "../../shared/lib/api-keys.js";
import { trackMcpKeyCreated } from "../../shared/lib/telemetry.js";

export const mcpKeysRouter = router({
  list: authedProcedure.query(async ({ ctx }) => {
    return db
      .select({
        id: mcpKeys.id,
        name: mcpKeys.name,
        keyPrefix: mcpKeys.keyPrefix,
        createdAt: mcpKeys.createdAt,
      })
      .from(mcpKeys)
      .where(eq(mcpKeys.userId, ctx.user.id))
      .orderBy(mcpKeys.createdAt);
  }),

  create: memberInAnyOrgProcedure
    .input(z.object({ name: z.string().min(1).max(255) }))
    .mutation(async ({ input, ctx }) => {
      const rawKey = generateMcpKey();
      const [key] = await db
        .insert(mcpKeys)
        .values({
          userId: ctx.user.id,
          name: input.name,
          keyHash: hashApiKey(rawKey),
          keyPrefix: getKeyPrefix(rawKey),
        })
        .returning({
          id: mcpKeys.id,
          name: mcpKeys.name,
          keyPrefix: mcpKeys.keyPrefix,
          createdAt: mcpKeys.createdAt,
        });

      trackMcpKeyCreated();
      return { ...key, rawKey };
    }),

  delete: memberInAnyOrgProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const [key] = await db
        .select({ userId: mcpKeys.userId })
        .from(mcpKeys)
        .where(eq(mcpKeys.id, input.id));

      if (!key) throw new TRPCError({ code: "NOT_FOUND" });
      if (key.userId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      await db.delete(mcpKeys).where(eq(mcpKeys.id, input.id));
    }),
});
