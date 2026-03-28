import { z } from "zod";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  router,
  authedProcedure,
  projectMemberProcedure,
  projectAdminProcedure,
  checkOrgRole,
} from "../../trpc.js";
import { db } from "../../shared/db/postgres.js";
import { apiKeys, project } from "../../shared/db/schema.js";
import {
  generateApiKey,
  hashApiKey,
  getKeyPrefix,
} from "../../shared/lib/api-keys.js";
import { trackApiKeyCreated } from "../../shared/lib/telemetry.js";

export const apiKeysRouter = router({
  list: projectMemberProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ input }) => {
      return db
        .select({
          id: apiKeys.id,
          name: apiKeys.name,
          keyPrefix: apiKeys.keyPrefix,
          createdAt: apiKeys.createdAt,
        })
        .from(apiKeys)
        .where(eq(apiKeys.projectId, input.projectId))
        .orderBy(apiKeys.createdAt);
    }),

  create: projectAdminProcedure
    .input(
      z.object({
        projectId: z.string(),
        name: z.string().min(1).max(255),
      })
    )
    .mutation(async ({ input }) => {
      const rawKey = generateApiKey();
      const [key] = await db
        .insert(apiKeys)
        .values({
          projectId: input.projectId,
          name: input.name,
          keyHash: hashApiKey(rawKey),
          keyPrefix: getKeyPrefix(rawKey),
        })
        .returning({
          id: apiKeys.id,
          name: apiKeys.name,
          keyPrefix: apiKeys.keyPrefix,
          createdAt: apiKeys.createdAt,
        });

      trackApiKeyCreated();
      return { ...key, rawKey };
    }),

  delete: authedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const [key] = await db
        .select({ projectId: apiKeys.projectId })
        .from(apiKeys)
        .where(eq(apiKeys.id, input.id));
      if (!key) throw new TRPCError({ code: "NOT_FOUND" });
      // Look up project's org to check role
      const [p] = await db
        .select({ organizationId: project.organizationId })
        .from(project)
        .where(eq(project.id, key.projectId));
      if (!p) throw new TRPCError({ code: "NOT_FOUND" });
      await checkOrgRole(ctx.user.id, p.organizationId, ["admin", "owner"]);
      await db.delete(apiKeys).where(eq(apiKeys.id, input.id));
    }),
});
