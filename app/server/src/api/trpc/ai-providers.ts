import { z } from "zod";
import { eq } from "drizzle-orm";
import { router, projectMemberProcedure, projectAdminProcedure } from "../../trpc.js";
import { db } from "../../shared/db/postgres.js";
import { aiProviders } from "../../shared/db/schema.js";
import { encrypt, maskApiKey } from "../../shared/lib/encryption.js";
import { trackAiProviderConfigured } from "../../shared/lib/telemetry.js";

const providerEnum = z.enum(["openai", "anthropic", "openrouter", "custom"]);

export const aiProvidersRouter = router({
  get: projectMemberProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ input }) => {
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

  upsert: projectAdminProcedure
    .input(
      z
        .object({
          projectId: z.string(),
          provider: providerEnum,
          apiKey: z.string().min(1).optional(),
          modelId: z.string().min(1).max(255),
          baseUrl: z.string().url().nullish(),
        })
        .refine(
          (d) => d.provider !== "custom" || (d.baseUrl && d.baseUrl.length > 0),
          { message: "Base URL is required for custom providers", path: ["baseUrl"] }
        )
    )
    .mutation(async ({ input }) => {
      const now = new Date();

      // Check if a config already exists
      const [existing] = await db
        .select({ id: aiProviders.id })
        .from(aiProviders)
        .where(eq(aiProviders.projectId, input.projectId));

      // API key is required for new configs
      if (!existing && !input.apiKey) {
        throw new Error("API key is required when creating a new provider config");
      }

      const keyFields = input.apiKey
        ? {
            encryptedApiKey: encrypt(input.apiKey),
            apiKeyMask: maskApiKey(input.apiKey),
          }
        : {};

      const [row] = await db
        .insert(aiProviders)
        .values({
          projectId: input.projectId,
          provider: input.provider,
          encryptedApiKey: keyFields.encryptedApiKey ?? "",
          apiKeyMask: keyFields.apiKeyMask ?? "",
          modelId: input.modelId,
          baseUrl: input.baseUrl ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: aiProviders.projectId,
          set: {
            provider: input.provider,
            ...keyFields,
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

      trackAiProviderConfigured(input.provider);
      return row;
    }),

  delete: projectAdminProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(async ({ input }) => {
      await db
        .delete(aiProviders)
        .where(eq(aiProviders.projectId, input.projectId));
    }),
});
