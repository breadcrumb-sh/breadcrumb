import { readonlyClickhouse } from "../db/clickhouse.js";
import {
  validateAndRewriteQuery,
  QueryValidationError,
} from "./query-validator.js";
import { trackSlowClickhouseQuery, trackQueryRejected } from "./telemetry.js";
import { createLogger } from "./logger.js";

const log = createLogger("sandboxed-query");

export { QueryValidationError };

/** ClickHouse resource limits for sandboxed queries.
 *  Type notes: Seconds = number, UInt64 = string, OverflowMode = 'throw'|'break' */
const SANDBOXED_QUERY_SETTINGS = {
  /** Kill query after 30 seconds (Seconds = number) */
  max_execution_time: 30,
  /** Return at most 10 000 rows (UInt64 = string) */
  max_result_rows: "10000",
  /** Throw if result exceeds max_result_rows */
  result_overflow_mode: "throw" as const,
  /** Cap the serialized result payload to 1 MiB (UInt64 = string) */
  max_result_bytes: "1048576",
  /** Scan at most 1 million rows from tables (UInt64 = string) */
  max_rows_to_read: "1000000",
  /** Scan at most 25 MiB from storage (UInt64 = string) */
  max_bytes_to_read: "25000000",
  /** Cap per-query memory to 500 MB (UInt64 = string) */
  max_memory_usage: "500000000",
};

export { SANDBOXED_QUERY_SETTINGS };

interface RunSandboxedQueryOptions {
  abortSignal?: AbortSignal;
}

/**
 * Execute a SQL query with project isolation.
 *
 * Every query is parsed into an AST, validated against allowlists (tables,
 * functions, statement types), and rewritten to inject project_id filters on
 * every table reference. The validated SQL is then executed via the readonly
 * ClickHouse client.
 */
export async function runSandboxedQuery(
  projectId: string,
  sql: string,
  source = "explore",
  extraParams?: Record<string, unknown>,
  options?: RunSandboxedQueryOptions,
): Promise<Record<string, unknown>[]> {
  const start = performance.now();

  let validatedSql: string;
  try {
    validatedSql = validateAndRewriteQuery(sql, projectId);
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

  const result = await readonlyClickhouse.query({
    query: validatedSql,
    // projectId MUST come last so extraParams can never override it
    query_params: { ...extraParams, projectId },
    format: "JSONEachRow",
    clickhouse_settings: SANDBOXED_QUERY_SETTINGS,
    abort_signal: options?.abortSignal,
  });
  const rows = (await result.json()) as Record<string, unknown>[];

  trackSlowClickhouseQuery(source, performance.now() - start);
  return rows;
}
