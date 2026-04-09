/**
 * Rate lookup and cost computation.
 *
 * Single source of truth for "given a project and a model name, what do
 * tokens cost?" Used at ingest time to fill `input_cost_usd` /
 * `output_cost_usd` on LLM spans, and at runner time (scan / investigate /
 * repo-scan) to compute the cost of an agent run for the monthly budget.
 *
 * Lookup order:
 *   1. DB row in `model_rates` for (projectId, normalizedModel)
 *      - if source='unset' but the catalog now knows the model, promote it
 *        to source='catalog' on the fly
 *   2. Pricing catalog entry (vendored from LiteLLM)
 *      - insert into the DB (source='catalog') so it shows in the UI,
 *        return it
 *   3. None found — insert placeholder row (source='unset', rates=0),
 *      return null. Cost stays 0 on the span; UI shows a warning.
 */

import { and, eq } from "drizzle-orm";
import { db } from "../../shared/db/postgres.js";
import { modelRates } from "../../shared/db/schema.js";
import {
  getLitellmCatalog,
  type CatalogEntry,
} from "../../shared/lib/litellm-catalog.js";
import { normalizeModelName } from "../../shared/lib/model-normalization.js";
import { createLogger } from "../../shared/lib/logger.js";

/**
 * Try to find a model in the catalog, with dot/hyphen version-separator
 * fallback. LiteLLM is inconsistent: OpenAI-style keys use dots
 * (`gpt-4.1`, `gpt-3.5-turbo`) while Anthropic Claude 4.x keys use
 * hyphens (`claude-sonnet-4-6`). A user referencing either form should
 * hit the catalog entry.
 */
function findInCatalog(
  catalog: Map<string, CatalogEntry>,
  model: string,
): CatalogEntry | undefined {
  const direct = catalog.get(model);
  if (direct) return direct;

  // Only touches digit.digit or digit-digit sequences — structural hyphens
  // (`claude-sonnet-...`) and non-version dots are left alone.
  const asHyphen = model.replace(/(\d)\.(\d)/g, "$1-$2");
  if (asHyphen !== model) {
    const hit = catalog.get(asHyphen);
    if (hit) return hit;
  }
  const asDot = model.replace(/(\d)-(\d)/g, "$1.$2");
  if (asDot !== model) {
    const hit = catalog.get(asDot);
    if (hit) return hit;
  }
  return undefined;
}

const log = createLogger("rate-lookup");

export type RateSource = "catalog" | "user" | "unset";

export interface ModelRate {
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
  cacheReadPerMillionUsd: number | null;
  cacheWritePerMillionUsd: number | null;
  reasoningPerMillionUsd: number | null;
  source: RateSource;
}

export interface CostInputTokens {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  cacheCreationInputTokens?: number;
  reasoningTokens?: number;
}

/**
 * Look up the rate for a model in a project, auto-populating from the
 * LiteLLM catalog or inserting an 'unset' placeholder if it's unknown.
 *
 * Returns `null` when the model isn't priceable (fresh unset placeholder).
 * Returns a rate with `source='catalog' | 'user' | 'openrouter'` when it is.
 * When `source='unset'` but the catalog now has the model, the row is
 * promoted in-place and the catalog rate is returned.
 */
export async function lookupRate(
  projectId: string,
  rawModel: string,
): Promise<ModelRate | null> {
  const model = normalizeModelName(rawModel);
  if (!model) return null;

  const [existing] = await db
    .select()
    .from(modelRates)
    .where(and(eq(modelRates.projectId, projectId), eq(modelRates.model, model)));

  if (existing) {
    // Auto-promote: if we previously marked it unset but the catalog knows
    // it now, update the row and return the catalog rate. Happens when a
    // model was seen before the catalog had it (or before we fetched a new
    // copy).
    if (existing.source === "unset") {
      const catalog = await getLitellmCatalog();
      const catEntry = findInCatalog(catalog, model);
      if (catEntry) {
        await db
          .update(modelRates)
          .set({
            inputPerMillionUsd: catEntry.inputPerMillionUsd.toString(),
            outputPerMillionUsd: catEntry.outputPerMillionUsd.toString(),
            cacheReadPerMillionUsd:
              catEntry.cacheReadPerMillionUsd?.toString() ?? null,
            cacheWritePerMillionUsd:
              catEntry.cacheWritePerMillionUsd?.toString() ?? null,
            reasoningPerMillionUsd:
              catEntry.reasoningPerMillionUsd?.toString() ?? null,
            source: "catalog",
            provider: catEntry.provider,
            updatedAt: new Date(),
          })
          .where(eq(modelRates.id, existing.id));
        log.debug({ projectId, model }, "promoted unset model to catalog");
        return catalogEntryToRate(catEntry, "catalog");
      }
      // Still unset and still unknown — no cost to compute.
      return null;
    }
    return rowToRate(existing);
  }

  // No DB row yet — try the catalog.
  const catalog = await getLitellmCatalog();
  const catEntry = findInCatalog(catalog, model);

  if (catEntry) {
    await db
      .insert(modelRates)
      .values({
        projectId,
        model,
        provider: catEntry.provider,
        inputPerMillionUsd: catEntry.inputPerMillionUsd.toString(),
        outputPerMillionUsd: catEntry.outputPerMillionUsd.toString(),
        cacheReadPerMillionUsd:
          catEntry.cacheReadPerMillionUsd?.toString() ?? null,
        cacheWritePerMillionUsd:
          catEntry.cacheWritePerMillionUsd?.toString() ?? null,
        reasoningPerMillionUsd:
          catEntry.reasoningPerMillionUsd?.toString() ?? null,
        source: "catalog",
      })
      .onConflictDoNothing({
        target: [modelRates.projectId, modelRates.model],
      });
    return catalogEntryToRate(catEntry, "catalog");
  }

  // Model is unknown — create an 'unset' placeholder so the UI can prompt
  // the user to enter rates. Cost stays 0.
  await db
    .insert(modelRates)
    .values({
      projectId,
      model,
      provider: null,
      inputPerMillionUsd: "0",
      outputPerMillionUsd: "0",
      source: "unset",
    })
    .onConflictDoNothing({
      target: [modelRates.projectId, modelRates.model],
    });

  log.debug({ projectId, model }, "model unknown, placeholder inserted");
  return null;
}

/**
 * Compute per-span cost in USD from token counts and a rate.
 *
 * Cache / reasoning tokens are subtotals already included in the provider's
 * reported total (input_tokens / output_tokens). We split them out and apply
 * the right per-bucket rate, falling back to the base input/output rate when
 * a specific cache/reasoning rate isn't set.
 */
export function computeSpanCost(
  rate: ModelRate,
  tokens: CostInputTokens,
): { inputCostUsd: number; outputCostUsd: number } {
  const PER_MILLION = 1_000_000;

  const cacheRead = tokens.cachedInputTokens ?? 0;
  const cacheWrite = tokens.cacheCreationInputTokens ?? 0;
  // Clamp base input to non-negative: some providers include cache tokens
  // in the total, others don't — we assume they do.
  const baseInput = Math.max(0, tokens.inputTokens - cacheRead - cacheWrite);

  const cacheReadRate = rate.cacheReadPerMillionUsd ?? rate.inputPerMillionUsd;
  const cacheWriteRate = rate.cacheWritePerMillionUsd ?? rate.inputPerMillionUsd;

  const inputCostUsd =
    (baseInput * rate.inputPerMillionUsd +
      cacheRead * cacheReadRate +
      cacheWrite * cacheWriteRate) /
    PER_MILLION;

  const reasoning = tokens.reasoningTokens ?? 0;
  const baseOutput = Math.max(0, tokens.outputTokens - reasoning);
  const reasoningRate = rate.reasoningPerMillionUsd ?? rate.outputPerMillionUsd;

  const outputCostUsd =
    (baseOutput * rate.outputPerMillionUsd + reasoning * reasoningRate) /
    PER_MILLION;

  return { inputCostUsd, outputCostUsd };
}

// ── Helpers ─────────────────────────────────────────────────────────

function rowToRate(row: typeof modelRates.$inferSelect): ModelRate {
  return {
    inputPerMillionUsd: Number(row.inputPerMillionUsd),
    outputPerMillionUsd: Number(row.outputPerMillionUsd),
    cacheReadPerMillionUsd:
      row.cacheReadPerMillionUsd != null ? Number(row.cacheReadPerMillionUsd) : null,
    cacheWritePerMillionUsd:
      row.cacheWritePerMillionUsd != null
        ? Number(row.cacheWritePerMillionUsd)
        : null,
    reasoningPerMillionUsd:
      row.reasoningPerMillionUsd != null ? Number(row.reasoningPerMillionUsd) : null,
    source: row.source as RateSource,
  };
}

function catalogEntryToRate(entry: CatalogEntry, source: RateSource): ModelRate {
  return {
    inputPerMillionUsd: entry.inputPerMillionUsd,
    outputPerMillionUsd: entry.outputPerMillionUsd,
    cacheReadPerMillionUsd: entry.cacheReadPerMillionUsd,
    cacheWritePerMillionUsd: entry.cacheWritePerMillionUsd,
    reasoningPerMillionUsd: entry.reasoningPerMillionUsd,
    source,
  };
}

/**
 * Convenience wrapper used by the runner path: look up the rate, compute
 * cost from `generateText` usage, return the total in integer cents ready
 * for `recordUsage`. Returns 0 when the model is unknown (unset) — the
 * budget ceiling treats unknown-cost runs as free until the user enters
 * rates.
 */
export async function computeRunCostCents(
  projectId: string,
  modelId: string,
  usage: CostInputTokens,
): Promise<number> {
  const rate = await lookupRate(projectId, modelId);
  if (!rate) return 0;
  const { inputCostUsd, outputCostUsd } = computeSpanCost(rate, usage);
  return Math.ceil((inputCostUsd + outputCostUsd) * 100);
}
