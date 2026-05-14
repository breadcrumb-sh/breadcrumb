/**
 * Pure helper functions for the MCP server.
 * Extracted to a separate module so they can be unit tested.
 */

// Return wall-clock duration in ms, or null if end time is missing/invalid.
export function calcDuration(startTime: string, endTime: string | null): number | null {
  if (!endTime) return null;
  const d = new Date(endTime).getTime() - new Date(startTime).getTime();
  return d > 0 ? d : null;
}

// ClickHouse returns DateTime64 as "YYYY-MM-DD HH:MM:SS.mmm" with no timezone.
// All times are stored in UTC — normalise to ISO 8601 with Z suffix so callers
// never have to guess the timezone.
export function toUtc(s: string | null | undefined): string | null {
  if (!s) return null;
  // Already has a timezone indicator (+HH:MM, Z, or ends with offset)
  if (s.includes("Z") || s.includes("+") || /[0-9][+-][0-9]{2}:[0-9]{2}$/.test(s)) return s;
  return s.replace(" ", "T") + "Z";
}

// Truncate a span input/output string for use in list responses.
// Full content is available via get_span.
const SPAN_FIELD_LIMIT = 500;
export function truncateSpanField(v: string | null, fieldName: string): string | null {
  if (!v || v.length <= SPAN_FIELD_LIMIT) return v;
  return v.slice(0, SPAN_FIELD_LIMIT) + `… [truncated, ${v.length} chars total — use get_span for full content]`;
}

// Metadata comes back as a parsed JS object from the ClickHouse JSON client.
// String() would give "[object Object]", so keep it as-is.
export function normMetadata(v: unknown): unknown {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "string") {
    try { return JSON.parse(v); } catch { return v || null; }
  }
  return v; // already an object
}
