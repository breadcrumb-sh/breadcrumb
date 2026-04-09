/**
 * Model name normalization for rate-table lookup.
 *
 * The same model can arrive under several different surface names:
 *   - "claude-sonnet-4-5"
 *   - "anthropic/claude-sonnet-4-5"
 *   - "claude-sonnet-4-5-20250929"
 *   - "Claude-Sonnet-4-5"
 *
 * We want them all to hit the same rate row in `model_rates`. The catalog
 * keys and the DB rate keys both use the normalized form, so matching is
 * consistent across the ingest path, the runner path, and the UI.
 *
 * Rules:
 *   1. Lowercase.
 *   2. Strip "default-provider" prefixes (`anthropic/`, `openai/`).
 *      Same price whether the caller used the prefix or not.
 *   3. Keep other provider prefixes (`bedrock/`, `azure/`, `vertex_ai/`,
 *      `fireworks/`, ...) — pricing differs per host.
 *   4. Strip trailing date suffixes:
 *       - ISO-style: `-20250929`, `-2024-11-20`
 *       - Claude-style `-latest` flavour is left alone (not a date).
 */

const DEFAULT_PROVIDER_PREFIXES = ["anthropic/", "openai/"];

// Matches:
//   -20250929           (YYYYMMDD)
//   -2024-11-20         (YYYY-MM-DD)
// Must be at the end of the string.
const DATE_SUFFIX_RE = /-(\d{8}|\d{4}-\d{2}-\d{2})$/;

export function normalizeModelName(raw: string): string {
  if (!raw) return "";
  let s = raw.trim().toLowerCase();
  for (const prefix of DEFAULT_PROVIDER_PREFIXES) {
    if (s.startsWith(prefix)) {
      s = s.slice(prefix.length);
      break;
    }
  }
  s = s.replace(DATE_SUFFIX_RE, "");
  return s;
}
