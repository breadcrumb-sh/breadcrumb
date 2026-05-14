import { z } from "zod";
import { router, projectViewerProcedure } from "../../../trpc.js";
import { readonlyClickhouse } from "../../../shared/db/clickhouse.js";
import { buildTraceFilters, filterInput, ROLLUPS_SUBQUERY, getProjectTimezone } from "../../../services/traces/helpers.js";

export const statsRouter = router({
  stats: projectViewerProcedure
    .input(z.object({ projectId: z.string().uuid(), ...filterInput }))
    .query(async ({ input }) => {
      const { whereStr, params } = buildTraceFilters(input);

      const statsQuery = `
        SELECT
          count()                             AS trace_count,
          countIf(t.status = 'error')         AS error_count,
          sum(coalesce(r.total_cost_usd, 0))  AS total_cost_usd,
          sum(coalesce(r.total_tokens, 0))    AS total_tokens,
          sum(coalesce(r.total_input_tokens, 0))    AS input_tokens,
          sum(coalesce(r.total_output_tokens, 0))   AS output_tokens,
          avgIf(
            toInt64(toUnixTimestamp64Milli(COALESCE(t.end_time, r.max_end_time))) - toInt64(toUnixTimestamp64Milli(t.start_time)),
            isNotNull(COALESCE(t.end_time, r.max_end_time)) AND COALESCE(t.end_time, r.max_end_time) > t.start_time
          ) AS avg_duration_ms
        FROM (
          SELECT
            id,
            argMax(name, version)         AS name,
            argMax(start_time, version)   AS start_time,
            argMax(end_time, version)     AS end_time,
            argMax(status, version)       AS status,
            argMax(environment, version)  AS environment
          FROM breadcrumb.traces
          WHERE project_id = {projectId: UUID}
          GROUP BY id
        ) t
        LEFT JOIN (
          SELECT
            trace_id,
            sum(input_cost_usd + output_cost_usd) AS total_cost_usd,
            sum(input_tokens + output_tokens)      AS total_tokens,
            sum(input_tokens)                      AS total_input_tokens,
            sum(output_tokens)                     AS total_output_tokens,
            max(max_end_time)                      AS max_end_time
          FROM breadcrumb.trace_rollups
          WHERE project_id = {projectId: UUID}
          GROUP BY trace_id
        ) r ON t.id = r.trace_id
        ${whereStr}
      `;

      // Build previous period query if date range is specified
      let prevPromise: Promise<Array<Record<string, unknown>>> | null = null;
      if (input.from && input.to) {
        const fromDate = new Date(input.from);
        const toDate = new Date(input.to);
        const days = Math.round((toDate.getTime() - fromDate.getTime()) / 86_400_000) + 1;
        const prevTo = new Date(fromDate);
        prevTo.setDate(prevTo.getDate() - 1);
        const prevFrom = new Date(prevTo);
        prevFrom.setDate(prevFrom.getDate() - days + 1);

        const prevInput = {
          ...input,
          from: prevFrom.toISOString().slice(0, 10),
          to: prevTo.toISOString().slice(0, 10),
        };
        const { whereStr: prevWhereStr, params: prevParams } = buildTraceFilters(prevInput);
        prevPromise = readonlyClickhouse.query({
          query: `
            SELECT
              count()                             AS trace_count,
              countIf(t.status = 'error')         AS error_count,
              sum(coalesce(r.total_cost_usd, 0))  AS total_cost_usd,
              sum(coalesce(r.total_tokens, 0))    AS total_tokens,
              sum(coalesce(r.total_input_tokens, 0))    AS input_tokens,
              sum(coalesce(r.total_output_tokens, 0))   AS output_tokens,
              avgIf(
                toInt64(toUnixTimestamp64Milli(COALESCE(t.end_time, r.max_end_time))) - toInt64(toUnixTimestamp64Milli(t.start_time)),
                isNotNull(COALESCE(t.end_time, r.max_end_time)) AND COALESCE(t.end_time, r.max_end_time) > t.start_time
              ) AS avg_duration_ms
            FROM (
              SELECT
                id,
                argMax(name, version)         AS name,
                argMax(start_time, version)   AS start_time,
                argMax(end_time, version)     AS end_time,
                argMax(status, version)       AS status,
                argMax(environment, version)  AS environment
              FROM breadcrumb.traces
              WHERE project_id = {projectId: UUID}
              GROUP BY id
            ) t
            LEFT JOIN (
              SELECT
                trace_id,
                sum(input_cost_usd + output_cost_usd) AS total_cost_usd,
                sum(input_tokens + output_tokens)      AS total_tokens,
                sum(input_tokens)                      AS total_input_tokens,
                sum(output_tokens)                     AS total_output_tokens,
                max(max_end_time)                      AS max_end_time
              FROM breadcrumb.trace_rollups
              WHERE project_id = {projectId: UUID}
              GROUP BY trace_id
            ) r ON t.id = r.trace_id
            ${prevWhereStr}
          `,
          query_params: prevParams,
          format: "JSONEachRow",
        }).then((r) => r.json() as Promise<Array<Record<string, unknown>>>);
      }

      // Run current + previous period in parallel
      const [result, prevRows] = await Promise.all([
        readonlyClickhouse.query({ query: statsQuery, query_params: params, format: "JSONEachRow" }),
        prevPromise,
      ]);

      const rows = (await result.json()) as Array<Record<string, unknown>>;
      const row = rows[0] ?? {};
      const traceCount = Number(row["trace_count"] ?? 0);
      const errorCount = Number(row["error_count"] ?? 0);
      const totalCostUsd = Number(row["total_cost_usd"] ?? 0) / 1_000_000;
      const totalTokens = Number(row["total_tokens"] ?? 0);
      const inputTokens = Number(row["input_tokens"] ?? 0);
      const outputTokens = Number(row["output_tokens"] ?? 0);
      const avgDurationMs = Number(row["avg_duration_ms"] ?? 0);
      const errorRate = traceCount > 0 ? errorCount / traceCount : 0;

      let prev: { traceCount: number; totalCostUsd: number; totalTokens: number; inputTokens: number; outputTokens: number; avgDurationMs: number; errorRate: number } | null = null;
      if (prevRows) {
        const pr = prevRows[0] ?? {};
        const pTraceCount = Number(pr["trace_count"] ?? 0);
        const pErrorCount = Number(pr["error_count"] ?? 0);
        prev = {
          traceCount: pTraceCount,
          totalCostUsd: Number(pr["total_cost_usd"] ?? 0) / 1_000_000,
          totalTokens: Number(pr["total_tokens"] ?? 0),
          inputTokens: Number(pr["input_tokens"] ?? 0),
          outputTokens: Number(pr["output_tokens"] ?? 0),
          avgDurationMs: Number(pr["avg_duration_ms"] ?? 0),
          errorRate: pTraceCount > 0 ? pErrorCount / pTraceCount : 0,
        };
      }

      return {
        traceCount,
        totalCostUsd,
        totalTokens,
        inputTokens,
        outputTokens,
        avgDurationMs,
        errorCount,
        errorRate,
        prev,
      };
    }),

  dailyMetrics: projectViewerProcedure
    .input(z.object({ projectId: z.string().uuid(), ...filterInput }))
    .query(async ({ input }) => {
      const { whereStr, params } = buildTraceFilters(input);
      const tz = await getProjectTimezone(input.projectId);

      const result = await readonlyClickhouse.query({
        query: `
          SELECT
            toDate(t.start_time, {tz: String})  AS day,
            count()                             AS trace_count,
            countIf(t.status = 'error')         AS error_count,
            sum(coalesce(r.total_cost_usd, 0))  AS total_cost_usd,
            avgIf(
              toInt64(toUnixTimestamp64Milli(COALESCE(t.end_time, r.max_end_time))) - toInt64(toUnixTimestamp64Milli(t.start_time)),
              isNotNull(COALESCE(t.end_time, r.max_end_time)) AND COALESCE(t.end_time, r.max_end_time) > t.start_time
            ) AS avg_duration_ms
          FROM (
            SELECT
              id,
              argMax(name, version)         AS name,
              argMax(start_time, version)   AS start_time,
              argMax(end_time, version)     AS end_time,
              argMax(status, version)       AS status,
              argMax(environment, version)  AS environment
            FROM breadcrumb.traces
            WHERE project_id = {projectId: UUID}
            GROUP BY id
          ) t
          LEFT JOIN (
            SELECT
              trace_id,
              sum(input_cost_usd + output_cost_usd) AS total_cost_usd,
              max(max_end_time)                      AS max_end_time
            FROM breadcrumb.trace_rollups
            WHERE project_id = {projectId: UUID}
            GROUP BY trace_id
          ) r ON t.id = r.trace_id
          ${whereStr}
          GROUP BY day
          ORDER BY day ASC
        `,
        query_params: { ...params, tz },
        format: "JSONEachRow",
      });

      const rows = (await result.json()) as Array<Record<string, unknown>>;
      return rows.map((r) => ({
        date:          String(r["day"]),
        traces:        Number(r["trace_count"]),
        errors:        Number(r["error_count"]),
        costUsd:       Number(r["total_cost_usd"]) / 1_000_000,
        avgDurationMs: Number(r["avg_duration_ms"] ?? 0),
      }));
    }),

  dailyCostByName: projectViewerProcedure
    .input(z.object({ projectId: z.string().uuid(), ...filterInput }))
    .query(async ({ input }) => {
      const { whereStr, params } = buildTraceFilters(input);
      const tz = await getProjectTimezone(input.projectId);

      const result = await readonlyClickhouse.query({
        query: `
          SELECT
            toDate(t.start_time, {tz: String})             AS day,
            t.name                                         AS trace_name,
            count()                                        AS trace_count,
            sum(coalesce(r.total_cost_usd, 0))             AS total_cost_usd
          FROM (
            SELECT
              id,
              argMax(name, version)         AS name,
              argMax(start_time, version)   AS start_time,
              argMax(status, version)       AS status,
              argMax(environment, version)  AS environment
            FROM breadcrumb.traces
            WHERE project_id = {projectId: UUID}
            GROUP BY id
          ) t
          LEFT JOIN (
            SELECT
              trace_id,
              sum(input_cost_usd + output_cost_usd) AS total_cost_usd
            FROM breadcrumb.trace_rollups
            WHERE project_id = {projectId: UUID}
            GROUP BY trace_id
          ) r ON t.id = r.trace_id
          ${whereStr}
          GROUP BY day, trace_name
          ORDER BY day ASC, trace_name ASC
        `,
        query_params: { ...params, tz },
        format: "JSONEachRow",
      });

      const rows = (await result.json()) as Array<Record<string, unknown>>;
      return rows.map((r) => ({
        date:      String(r["day"]),
        name:      String(r["trace_name"]),
        traces:    Number(r["trace_count"]),
        costUsd:   Number(r["total_cost_usd"]) / 1_000_000,
      }));
    }),

  qualityTimeline: projectViewerProcedure
    .input(z.object({ projectId: z.string().uuid(), ...filterInput }))
    .query(async ({ input }) => {
      const { whereStr, params } = buildTraceFilters(input);
      const tz = await getProjectTimezone(input.projectId);

      // Step 1: compute p75 cost & duration from successful traces in the range
      const threshResult = await readonlyClickhouse.query({
        query: `
          SELECT
            quantile(0.75)(total_cost_usd) AS p75_cost,
            quantile(0.75)(duration_ms)    AS p75_duration
          FROM (
            SELECT
              coalesce(r.total_cost_usd, 0) AS total_cost_usd,
              if(
                isNotNull(COALESCE(t.end_time, r.max_end_time)) AND COALESCE(t.end_time, r.max_end_time) > t.start_time,
                toInt64(toUnixTimestamp64Milli(COALESCE(t.end_time, r.max_end_time))) - toInt64(toUnixTimestamp64Milli(t.start_time)),
                0
              ) AS duration_ms
            FROM (
              SELECT
                id,
                argMax(name, version)         AS name,
                argMax(start_time, version)   AS start_time,
                argMax(end_time, version)     AS end_time,
                argMax(status, version)       AS status,
                argMax(environment, version)  AS environment
              FROM breadcrumb.traces
              WHERE project_id = {projectId: UUID}
              GROUP BY id
            ) t
            LEFT JOIN (
              SELECT
                trace_id,
                sum(input_cost_usd + output_cost_usd) AS total_cost_usd,
                max(max_end_time)                      AS max_end_time
              FROM breadcrumb.trace_rollups
              WHERE project_id = {projectId: UUID}
              GROUP BY trace_id
            ) r ON t.id = r.trace_id
            ${whereStr}
            AND t.status != 'error'
          )
        `,
        query_params: params,
        format: "JSONEachRow",
      });

      const threshRows = (await threshResult.json()) as Array<Record<string, unknown>>;
      const p75Cost     = Number(threshRows[0]?.["p75_cost"]     ?? 0);
      const p75Duration = Number(threshRows[0]?.["p75_duration"] ?? 0);

      // Step 2: classify each trace per day using those thresholds
      const result = await readonlyClickhouse.query({
        query: `
          SELECT
            toDate(t.start_time, {tz: String}) AS day,
            countIf(t.status = 'error') AS failed,
            countIf(
              t.status != 'error'
              AND (
                coalesce(r.total_cost_usd, 0) > {p75Cost: Float64}
                OR if(
                  isNotNull(COALESCE(t.end_time, r.max_end_time)) AND COALESCE(t.end_time, r.max_end_time) > t.start_time,
                  toInt64(toUnixTimestamp64Milli(COALESCE(t.end_time, r.max_end_time))) - toInt64(toUnixTimestamp64Milli(t.start_time)),
                  0
                ) > {p75Duration: Float64}
              )
            ) AS expensive,
            countIf(
              t.status != 'error'
              AND coalesce(r.total_cost_usd, 0) <= {p75Cost: Float64}
              AND if(
                isNotNull(COALESCE(t.end_time, r.max_end_time)) AND COALESCE(t.end_time, r.max_end_time) > t.start_time,
                toInt64(toUnixTimestamp64Milli(COALESCE(t.end_time, r.max_end_time))) - toInt64(toUnixTimestamp64Milli(t.start_time)),
                0
              ) <= {p75Duration: Float64}
            ) AS healthy
          FROM (
            SELECT
              id,
              argMax(name, version)         AS name,
              argMax(start_time, version)   AS start_time,
              argMax(end_time, version)     AS end_time,
              argMax(status, version)       AS status,
              argMax(environment, version)  AS environment
            FROM breadcrumb.traces
            WHERE project_id = {projectId: UUID}
            GROUP BY id
          ) t
          LEFT JOIN (
            SELECT
              trace_id,
              sum(input_cost_usd + output_cost_usd) AS total_cost_usd,
              max(max_end_time)                      AS max_end_time
            FROM breadcrumb.trace_rollups
            WHERE project_id = {projectId: UUID}
            GROUP BY trace_id
          ) r ON t.id = r.trace_id
          ${whereStr}
          GROUP BY day
          ORDER BY day ASC
        `,
        query_params: { ...params, p75Cost, p75Duration, tz },
        format: "JSONEachRow",
      });

      const rows = (await result.json()) as Array<Record<string, unknown>>;
      return {
        thresholds: {
          p75CostUsd:    p75Cost / 1_000_000,
          p75DurationMs: p75Duration,
        },
        days: rows.map((r) => ({
          date:      String(r["day"]),
          healthy:   Number(r["healthy"]),
          expensive: Number(r["expensive"]),
          failed:    Number(r["failed"]),
        })),
      };
    }),
});
