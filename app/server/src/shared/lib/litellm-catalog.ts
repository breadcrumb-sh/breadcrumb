/**
 * LiteLLM pricing catalog loader.
 *
 * LiteLLM maintains a community JSON file at
 *   https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json
 * tracking ~2500 models across every major provider with per-token input,
 * output, cache-read, cache-write, and reasoning rates. It's the de-facto
 * upstream for LLM observability tools.
 *
 * Strategy:
 *   - Fetch on first use, cache in memory for 24 hours
 *   - Fall back to the vendored snapshot shipped in `data/litellm-snapshot.json`
 *     if the fetch fails (airgapped deploys, GitHub downtime)
 *   - Restart = fresh fetch (no cron needed)
 *
 * The returned catalog is keyed by `normalizeModelName(litellmKey)` — the
 * same normalization the ingest rate lookup uses — so matching is consistent.
 * Entries with neither `input_cost_per_token` nor `output_cost_per_token` set
 * are skipped (they're embedding / image / audio models we don't cost today).
 */

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLogger } from "./logger.js";
import { normalizeModelName } from "./model-normalization.js";

const log = createLogger("litellm-catalog");

const CATALOG_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const CATALOG_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface CatalogEntry {
  /** $ per million tokens */
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
  cacheReadPerMillionUsd: number | null;
  cacheWritePerMillionUsd: number | null;
  reasoningPerMillionUsd: number | null;
  provider: string | null;
}

let cached: Map<string, CatalogEntry> | null = null;
let cachedAt = 0;
let inflight: Promise<Map<string, CatalogEntry>> | null = null;

/**
 * Returns the LiteLLM catalog as a Map keyed on normalized model names.
 * Safe to call concurrently — overlapping fetches are deduplicated.
 */
export async function getLitellmCatalog(): Promise<Map<string, CatalogEntry>> {
  if (cached && Date.now() - cachedAt < CATALOG_TTL_MS) {
    return cached;
  }
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const remote = await fetchRemote();
      cached = remote;
      cachedAt = Date.now();
      log.info({ entries: remote.size }, "litellm catalog loaded from upstream");
      return remote;
    } catch (err) {
      log.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "litellm upstream fetch failed, falling back to vendored snapshot",
      );
      const local = await loadVendoredSnapshot();
      // Only overwrite the cache if we don't already have something newer.
      if (!cached) {
        cached = local;
        cachedAt = Date.now();
      }
      return cached ?? local;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

async function fetchRemote(): Promise<Map<string, CatalogEntry>> {
  const res = await fetch(CATALOG_URL, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`Catalog fetch failed: HTTP ${res.status}`);
  }
  const json = (await res.json()) as Record<string, unknown>;
  return parseCatalog(json);
}

async function loadVendoredSnapshot(): Promise<Map<string, CatalogEntry>> {
  // Resolve relative to this module's location so the lookup works in both
  // dev (tsx watch from services/server) and production (bundled in dist/).
  const here = dirname(fileURLToPath(import.meta.url));
  // Module lives at src/shared/lib/, snapshot at src/data/
  const candidates = [
    join(here, "..", "..", "data", "litellm-snapshot.json"),
    join(here, "..", "..", "..", "src", "data", "litellm-snapshot.json"),
  ];
  let lastErr: unknown;
  for (const path of candidates) {
    try {
      const raw = await readFile(path, "utf-8");
      const json = JSON.parse(raw) as Record<string, unknown>;
      const parsed = parseCatalog(json);
      log.info(
        { entries: parsed.size, path },
        "litellm catalog loaded from vendored snapshot",
      );
      return parsed;
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(
    `Could not load vendored snapshot: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  );
}

function parseCatalog(
  json: Record<string, unknown>,
): Map<string, CatalogEntry> {
  const out = new Map<string, CatalogEntry>();
  for (const [rawKey, rawValue] of Object.entries(json)) {
    if (rawKey === "sample_spec") continue;
    if (!rawValue || typeof rawValue !== "object") continue;

    const entry = rawValue as Record<string, unknown>;
    const inputPerToken = numOrNull(entry["input_cost_per_token"]);
    const outputPerToken = numOrNull(entry["output_cost_per_token"]);
    // Skip entries with no chat-style cost fields (image, audio, embedding).
    if (inputPerToken == null && outputPerToken == null) continue;

    const catalogEntry: CatalogEntry = {
      inputPerMillionUsd: (inputPerToken ?? 0) * 1_000_000,
      outputPerMillionUsd: (outputPerToken ?? 0) * 1_000_000,
      cacheReadPerMillionUsd:
        numOrNull(entry["cache_read_input_token_cost"]) != null
          ? numOrNull(entry["cache_read_input_token_cost"])! * 1_000_000
          : null,
      cacheWritePerMillionUsd:
        numOrNull(entry["cache_creation_input_token_cost"]) != null
          ? numOrNull(entry["cache_creation_input_token_cost"])! * 1_000_000
          : null,
      // LiteLLM exposes `output_cost_per_reasoning_token` on some entries.
      reasoningPerMillionUsd:
        numOrNull(entry["output_cost_per_reasoning_token"]) != null
          ? numOrNull(entry["output_cost_per_reasoning_token"])! * 1_000_000
          : null,
      provider: typeof entry["litellm_provider"] === "string"
        ? (entry["litellm_provider"] as string)
        : null,
    };

    const normalized = normalizeModelName(rawKey);
    if (!normalized) continue;
    // First write wins — catalog has some duplicate aliases; keep the
    // canonical one we encounter first.
    if (!out.has(normalized)) {
      out.set(normalized, catalogEntry);
    }
  }
  return out;
}

function numOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

/** Test helper: clear the in-memory cache so the next call re-fetches. */
export function __resetCatalogForTests() {
  cached = null;
  cachedAt = 0;
  inflight = null;
}
