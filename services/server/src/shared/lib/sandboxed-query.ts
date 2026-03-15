import { sandboxedClickhouse, readonlyClickhouse } from "../db/clickhouse.js";
import { env } from "../../env.js";

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
 * Execute a SQL query with project isolation.
 *
 * When ENABLE_SANDBOXED_QUERIES=true, runs on the `ai_query` user with row policies
 * that enforce project isolation at the DB level. The SQL_project_id setting is
 * injected per-query, and SETTINGS clauses are stripped to prevent overrides.
 *
 * When sandboxing is disabled (default), falls back to the readonly client with
 * the projectId available as a query parameter. The SQL itself must use
 * {projectId: UUID} for filtering — there is no DB-level enforcement.
 */
export async function runSandboxedQuery(
  projectId: string,
  sql: string,
): Promise<Record<string, unknown>[]> {
  if (env.enableSandboxedQueries) {
    const result = await sandboxedClickhouse.query({
      query: sanitizeSql(sql),
      clickhouse_settings: { SQL_project_id: projectId },
      query_params: { projectId },
      format: "JSONEachRow",
    });
    return (await result.json()) as Record<string, unknown>[];
  }

  // Fallback: readonly client with projectId as a query parameter.
  // No row-policy enforcement — relies on the SQL using {projectId: UUID}.
  const result = await readonlyClickhouse.query({
    query: sql,
    query_params: { projectId },
    format: "JSONEachRow",
  });
  return (await result.json()) as Record<string, unknown>[];
}
