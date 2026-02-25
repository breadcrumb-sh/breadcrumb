import { z } from "zod";
import { eq } from "drizzle-orm";
import { router, authedProcedure } from "../trpc.js";
import { db } from "../../db/index.js";
import { aiProviders } from "../../db/schema.js";
import { encrypt, maskApiKey } from "../../lib/encryption.js";
import { requireOrgMember, requireOrgRole } from "../orgAccess.js";

const providerEnum = z.enum(["openai", "anthropic", "openrouter", "custom"]);

export const aiProvidersRouter = router({
  get: authedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ input, ctx }) => {
      await requireOrgMember(ctx.user.id, ctx.user.role, input.projectId);
      const [row] = await db
        .select({
          id: aiProviders.id,
          provider: aiProviders.provider,
          apiKeyMask: aiProviders.apiKeyMask,
          modelId: aiProviders.modelId,
          baseUrl: aiProviders.baseUrl,
          updatedAt: aiProviders.updatedAt,
        })
        .from(aiProviders)
        .where(eq(aiProviders.projectId, input.projectId));
      return row ?? null;
    }),

  upsert: authedProcedure
    .input(
      z
        .object({
          projectId: z.string(),
          provider: providerEnum,
          apiKey: z.string().min(1),
          modelId: z.string().min(1).max(255),
          baseUrl: z.string().url().nullish(),
        })
        .refine(
          (d) => d.provider !== "custom" || (d.baseUrl && d.baseUrl.length > 0),
          { message: "Base URL is required for custom providers", path: ["baseUrl"] }
        )
    )
    .mutation(async ({ input, ctx }) => {
      await requireOrgRole(ctx.user.id, ctx.user.role, input.projectId, [
        "admin",
        "owner",
      ]);
      const encryptedApiKey = encrypt(input.apiKey);
      const apiKeyMask = maskApiKey(input.apiKey);
      const now = new Date();

      const [row] = await db
        .insert(aiProviders)
        .values({
          projectId: input.projectId,
          provider: input.provider,
          encryptedApiKey,
          apiKeyMask,
          modelId: input.modelId,
          baseUrl: input.baseUrl ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: aiProviders.projectId,
          set: {
            provider: input.provider,
            encryptedApiKey,
            apiKeyMask,
            modelId: input.modelId,
            baseUrl: input.baseUrl ?? null,
            updatedAt: now,
          },
        })
        .returning({
          id: aiProviders.id,
          provider: aiProviders.provider,
          apiKeyMask: aiProviders.apiKeyMask,
          modelId: aiProviders.modelId,
          baseUrl: aiProviders.baseUrl,
          updatedAt: aiProviders.updatedAt,
        });

      return row;
    }),

  delete: authedProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await requireOrgRole(ctx.user.id, ctx.user.role, input.projectId, [
        "admin",
        "owner",
      ]);
      await db
        .delete(aiProviders)
        .where(eq(aiProviders.projectId, input.projectId));
    }),
});
