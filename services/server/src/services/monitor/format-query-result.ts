/**
 * Shared formatting for ClickHouse query results.
 *
 * Used by both production handlers and eval handlers to produce
 * a consistent string representation of query results.
 */

const MAX_DISPLAY_ROWS = 50;

export function formatQueryResult(rows: unknown[]): string {
  const truncated = rows.length > MAX_DISPLAY_ROWS ? rows.slice(0, MAX_DISPLAY_ROWS) : rows;
  const json = JSON.stringify(truncated, null, 2);
  const note = rows.length > MAX_DISPLAY_ROWS ? `\n(showing ${MAX_DISPLAY_ROWS} of ${rows.length} rows)` : "";
  return `${rows.length} rows returned${note}\n${json}`;
}
