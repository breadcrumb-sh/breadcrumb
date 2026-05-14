/**
 * Shared formatting for ClickHouse query results.
 *
 * Used by both production handlers and eval handlers to produce
 * a consistent string representation of query results.
 */

const MAX_DISPLAY_ROWS = 20;

export function formatQueryResult(rows: unknown[]): string {
  const truncated = rows.length > MAX_DISPLAY_ROWS ? rows.slice(0, MAX_DISPLAY_ROWS) : rows;
  const json = JSON.stringify(truncated);
  const note = rows.length > MAX_DISPLAY_ROWS ? ` (showing ${MAX_DISPLAY_ROWS} of ${rows.length})` : "";
  return `${rows.length} rows${note}\n${json}`;
}
