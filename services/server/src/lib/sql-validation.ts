/**
 * Throws if the query is not a SELECT or WITH statement.
 * Prevents destructive SQL from being executed against ClickHouse.
 */
export function assertSelectOnly(sql: string): void {
  const trimmed = sql.trimStart().toUpperCase();
  if (!trimmed.startsWith("SELECT") && !trimmed.startsWith("WITH")) {
    throw new Error("Only SELECT queries are allowed");
  }
}
