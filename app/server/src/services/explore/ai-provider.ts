import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";
import { eq } from "drizzle-orm";
import { db } from "../../shared/db/postgres.js";
import { aiProviders } from "../../shared/db/schema.js";
import { decrypt } from "../../shared/lib/encryption.js";

interface AiProviderRow {
  provider: string;
  encryptedApiKey: string;
  modelId: string;
  baseUrl: string | null;
}

/**
 * Look up the org's AI provider config and return a ready-to-use
 * AI SDK LanguageModel. Throws if no config is found.
 */
export async function getAiModel(projectId: string): Promise<LanguageModel> {
  const { model } = await getAiModelWithMeta(projectId);
  return model;
}

/**
 * Same as `getAiModel` but also returns the model id and provider so the
 * caller can do rate-table lookups after an LLM run without re-querying.
 */
export async function getAiModelWithMeta(
  projectId: string,
): Promise<{ model: LanguageModel; modelId: string; provider: string }> {
  const [row] = await db
    .select({
      provider: aiProviders.provider,
      encryptedApiKey: aiProviders.encryptedApiKey,
      modelId: aiProviders.modelId,
      baseUrl: aiProviders.baseUrl,
    })
    .from(aiProviders)
    .where(eq(aiProviders.projectId, projectId));

  if (!row) {
    throw new Error("No AI provider configured for this project");
  }

  return {
    model: buildModel(row),
    modelId: row.modelId,
    provider: row.provider,
  };
}

function buildModel(row: AiProviderRow): LanguageModel {
  const apiKey = decrypt(row.encryptedApiKey);

  switch (row.provider) {
    case "openai": {
      const openai = createOpenAI({ apiKey });
      return openai(row.modelId);
    }
    case "anthropic": {
      const anthropic = createAnthropic({ apiKey });
      return anthropic(row.modelId);
    }
    case "openrouter": {
      // Use the dedicated provider (not createOpenAI) so OpenRouter's
      // non-standard usage.cost field surfaces via
      // providerMetadata.openrouter.usage.cost, which our span mapper reads.
      const openrouter = createOpenRouter({ apiKey });
      return openrouter(row.modelId, { usage: { include: true } });
    }
    case "custom": {
      const custom = createOpenAI({
        apiKey,
        baseURL: row.baseUrl!,
      });
      return custom.chat(row.modelId);
    }
    default:
      throw new Error(`Unknown AI provider: ${row.provider}`);
  }
}
