/**
 * Pure helper functions for the ingest pipeline.
 * Extracted to a separate module so they can be unit tested.
 */

// Convert float USD to integer micro-dollars.
// 1 USD = 1_000_000 µUSD. Math.round avoids floating point rounding errors
// (e.g. 0.001 * 1_000_000 = 999.9999... without rounding).
export function toMicroDollars(usd: number | undefined): number {
  if (usd == null) return 0;
  return Math.round(usd * 1_000_000);
}

// Serialise any JSON value to a string for ClickHouse String columns.
// Absent/null values become empty string (no Nullable columns in CH).
export function toJson(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

// ClickHouse DateTime64 expects "YYYY-MM-DD HH:MM:SS.mmm" not ISO 8601.
export function toChDate(iso: string): string {
  return iso.replace("T", " ").replace("Z", "");
}
