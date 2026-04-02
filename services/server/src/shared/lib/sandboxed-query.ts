import { sandboxedClickhouse } from "../db/clickhouse.js";
import {
  validateQuery,
  QueryValidationError,
} from "./query-validator.js";
import { trackSlowClickhouseQuery, trackQueryRejected } from "./telemetry.js";
import { createLogger } from "./logger.js";

const log = createLogger("sandboxed-query");

export { QueryValidationError };

/** ClickHouse resource limits for server-authored queries that want
 *  the same caps as sandboxed queries (e.g. traces.list).
 *  Sandboxed queries get these limits from the ClickHouse role instead. */
export const SANDBOXED_QUERY_SETTINGS = {
  max_execution_time: 30,
  max_result_rows: "10000",
  result_overflow_mode: "throw" as const,
  max_result_bytes: "1048576",
  max_rows_to_read: "1000000",
  max_bytes_to_read: "25000000",
  max_memory_usage: "500000000",
};

interface RunSandboxedQueryOptions {
  abortSignal?: AbortSignal;
}

/**
 * Execute a user-provided SQL query with project isolation.
 *
 * The query is validated (SELECT-only, no SETTINGS, no blocked functions)
 * then executed via the sandboxed ClickHouse client. Project isolation
 * is enforced by ClickHouse row policies — the SQL_project_id setting
 * tells ClickHouse which project's data to return.
 */
export async function runSandboxedQuery(
  projectId: string,
  sql: string,
  source = "explore",
  extraParams?: Record<string, unknown>,
  options?: RunSandboxedQueryOptions,
): Promise<Record<string, unknown>[]> {
  const start = performance.now();

  try {
    validateQuery(sql);
  } catch (err) {
    if (err instanceof QueryValidationError) {
      trackQueryRejected(source, err.code, err.details);
      log.warn(
        { source, code: err.code, details: err.details },
        "query rejected",
      );
    }
    throw err;
  }

  const result = await sandboxedClickhouse.query({
    query: sql,
    query_params: extraParams,
    format: "JSONEachRow",
    clickhouse_settings: { SQL_project_id: projectId },
    abort_signal: options?.abortSignal,
  });
  const rows = (await result.json()) as Record<string, unknown>[];

  trackSlowClickhouseQuery(source, performance.now() - start);
  return rows;
}
