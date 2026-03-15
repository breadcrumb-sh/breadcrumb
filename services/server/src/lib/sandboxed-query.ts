import { sandboxedClickhouse } from "../db/clickhouse.js";

/**
 * Strip any SETTINGS clause from user/AI SQL to prevent overriding SQL_project_id.
 *
 * ClickHouse SETTINGS is always the last clause in a statement. We find the last
 * occurrence of the SETTINGS keyword that isn't inside a string literal and remove
 * everything from that point onward.
 */
function sanitizeSql(sql: string): string {
  const upper = sql.toUpperCase();
  let inSingle = false;
  let inDouble = false;
  let lastSettings = -1;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (!inSingle && !inDouble && upper.startsWith("SETTINGS", i)) {
      const before = i === 0 || /\s/.test(sql[i - 1]);
      const after = i + 8 >= sql.length || /\s/.test(sql[i + 8]);
      if (before && after) lastSettings = i;
    }
  }

  if (lastSettings === -1) return sql;
  return sql.slice(0, lastSettings).trim();
}

/**
 * Execute a SQL query in the sandboxed ClickHouse environment.
 *
 * The query runs as the `ai_query` user which has row policies that automatically
 * filter all tables by `project_id = toUUID(getSetting('SQL_project_id'))`.
 * The projectId is injected via per-query clickhouse_settings — no session needed.
 *
 * Security layers:
 *   1. Row policies enforce project isolation (DB-level, impossible to bypass)
 *   2. readonly=2 + GRANT blocks writes and system table access
 *   3. sanitizeSql() strips SETTINGS clauses to prevent setting override
 *   4. Resource limits cap execution time, memory, and result size
 */
export async function runSandboxedQuery(
  projectId: string,
  sql: string,
): Promise<Record<string, unknown>[]> {
  const result = await sandboxedClickhouse.query({
    query: sanitizeSql(sql),
    clickhouse_settings: { SQL_project_id: projectId },
    query_params: { projectId }, // backward compat for saved chart SQL using {projectId: UUID}
    format: "JSONEachRow",
  });
  return (await result.json()) as Record<string, unknown>[];
}
