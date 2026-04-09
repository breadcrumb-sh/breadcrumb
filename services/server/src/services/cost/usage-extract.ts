/**
 * Shared helper: normalize the `usage` object returned by AI SDK's
 * `generateText` / `streamText` into the shape our rate-lookup expects.
 *
 * The AI SDK v6 usage object includes `inputTokens`, `outputTokens`,
 * `totalTokens`, and optionally `reasoningTokens` and `cachedInputTokens`
 * depending on the provider. Older versions use snake_case and some
 * providers use different keys — we read every reasonable alias so the
 * runner path doesn't have to care.
 */

import type { CostInputTokens } from "./rate-lookup.js";

type AnyUsage = Record<string, unknown> | undefined;

function num(u: AnyUsage, ...keys: string[]): number | undefined {
  if (!u) return undefined;
  for (const k of keys) {
    const v = u[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return undefined;
}

export function extractUsage(usage: unknown): CostInputTokens {
  const u = (usage ?? undefined) as AnyUsage;
  return {
    inputTokens: num(u, "inputTokens", "promptTokens", "input_tokens") ?? 0,
    outputTokens: num(u, "outputTokens", "completionTokens", "output_tokens") ?? 0,
    cachedInputTokens: num(
      u,
      "cachedInputTokens",
      "cached_input_tokens",
      "cacheReadInputTokens",
      "cache_read_input_tokens",
    ),
    cacheCreationInputTokens: num(
      u,
      "cacheCreationInputTokens",
      "cache_creation_input_tokens",
    ),
    reasoningTokens: num(u, "reasoningTokens", "reasoning_tokens"),
  };
}
