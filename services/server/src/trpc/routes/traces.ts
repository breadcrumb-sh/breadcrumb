import { z } from "zod";
import { router, procedure } from "../trpc.js";
import { clickhouse } from "../../db/clickhouse.js";
import { getAiModel } from "../../lib/ai-provider.js";
import { writeSearchQuery } from "../../lib/query-writer.js";
import { cache } from "../../lib/cache.js";

// ClickHouse Map columns (e.g. metadata) come back as JS objects from JSONEachRow.
// String() on an object produces "[object Object]", so we serialize explicitly.
function toStr(v: unknown): string {
  if (v == null || v === "") return "";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

// Reusable rollups subquery fragment.
const ROLLUPS_SUBQUERY = (projectIdParam: string) => `
  SELECT
    trace_id,
    sum(input_tokens)                     AS input_tokens,
    sum(output_tokens)                    AS output_tokens,
    sum(input_cost_usd)                   AS input_cost_usd,
    sum(output_cost_usd)                  AS output_cost_usd,
    sum(span_count)                       AS span_count,
    max(max_end_time)                     AS max_end_time
  FROM breadcrumb.trace_rollups
  WHERE project_id = {${projectIdParam}: UUID}
  GROUP BY trace_id
`;

// Build the WHERE clauses and params for the shared filter set.
// All filters are optional — omitting them returns all-time / unfiltered data.
function buildTraceFilters(input: {
  projectId: string;
  from?: string;
  to?: string;
  environments?: string[];
  models?: string[];
  names?: string[];
}) {
  const clauses: string[] = [];
  const params: Record<string, unknown> = { projectId: input.projectId };

  if (input.from) {
    clauses.push(`t.start_time >= {from: Date}`);
    params.from = input.from;
  }
  if (input.to) {
    clauses.push(`t.start_time < {to: Date} + INTERVAL 1 DAY`);
    params.to = input.to;
  }
  if (input.environments && input.environments.length > 0) {
    clauses.push(`t.environment IN {environments: Array(String)}`);
    params.environments = input.environments;
  }
  if (input.names && input.names.length > 0) {
    clauses.push(`t.name IN {names: Array(String)}`);
    params.names = input.names;
  }
  if (input.models && input.models.length > 0) {
    clauses.push(
      `t.id IN (
        SELECT DISTINCT trace_id
        FROM breadcrumb.spans
        WHERE project_id = {projectId: UUID}
          AND model IN {models: Array(String)}
      )`
    );
    params.models = input.models;
  }

  return {
    whereStr: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
}

// Shared filter input schema (all optional for backward compat)
const filterInput = {
  from:         z.string().optional(),  // YYYY-MM-DD
  to:           z.string().optional(),  // YYYY-MM-DD
  environments: z.array(z.string()).optional(),
  models:       z.array(z.string()).optional(),
  names:        z.array(z.string()).optional(),
};

export const tracesRouter = router({
  // Aggregated stats for the project dashboard header cards.
  stats: procedure
    .input(z.object({ projectId: z.string().uuid(), ...filterInput }))
    .query(async ({ input }) => {
      const { whereStr, params } = buildTraceFilters(input);

      const statsQuery = `
        SELECT
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
      `;

      // Run current period query
      const result = await clickhouse.query({
        query: statsQuery,
        query_params: params,
        format: "JSONEachRow",
      });
      const rows = (await result.json()) as Array<Record<string, unknown>>;
      const row = rows[0] ?? {};
      const traceCount = Number(row["trace_count"] ?? 0);
      const errorCount = Number(row["error_count"] ?? 0);
      const totalCostUsd = Number(row["total_cost_usd"] ?? 0) / 1_000_000;
      const avgDurationMs = Number(row["avg_duration_ms"] ?? 0);
      const errorRate = traceCount > 0 ? errorCount / traceCount : 0;

      // Compute previous period of equal length for comparison
      let prev: { traceCount: number; totalCostUsd: number; avgDurationMs: number; errorRate: number } | null = null;
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
        const prevResult = await clickhouse.query({
          query: `
            SELECT
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
            ${prevWhereStr}
          `,
          query_params: prevParams,
          format: "JSONEachRow",
        });
        const prevRows = (await prevResult.json()) as Array<Record<string, unknown>>;
        const pr = prevRows[0] ?? {};
        const pTraceCount = Number(pr["trace_count"] ?? 0);
        const pErrorCount = Number(pr["error_count"] ?? 0);
        prev = {
          traceCount: pTraceCount,
          totalCostUsd: Number(pr["total_cost_usd"] ?? 0) / 1_000_000,
          avgDurationMs: Number(pr["avg_duration_ms"] ?? 0),
          errorRate: pTraceCount > 0 ? pErrorCount / pTraceCount : 0,
        };
      }

      return {
        traceCount,
        totalCostUsd,
        avgDurationMs,
        errorCount,
        errorRate,
        prev,
      };
    }),

  // Paginated trace list for the dashboard table.
  list: procedure
    .input(
      z.object({
        projectId:   z.string().uuid(),
        limit:       z.number().int().min(1).max(100).default(50),
        offset:      z.number().int().min(0).default(0),
        from:        z.string().optional(),
        to:          z.string().optional(),
        names:       z.array(z.string()).optional(),
        models:      z.array(z.string()).optional(),
        statuses:    z.array(z.enum(["ok", "error"])).optional(),
        environments: z.array(z.string()).optional(),
        query:       z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      const clauses: string[] = [];
      const params: Record<string, unknown> = {
        projectId: input.projectId,
        limit:     input.limit,
        offset:    input.offset,
      };

      if (input.from)                              { clauses.push(`t.start_time >= {from: Date}`);                       params.from        = input.from; }
      if (input.to)                                { clauses.push(`t.start_time < {to: Date} + INTERVAL 1 DAY`);        params.to          = input.to; }
      if (input.names?.length)                     { clauses.push(`t.name IN {names: Array(String)}`);                  params.names       = input.names; }
      if (input.statuses?.length)                  { clauses.push(`t.status IN {statuses: Array(String)}`);             params.statuses    = input.statuses; }
      if (input.environments?.length)               { clauses.push(`t.environment IN {environments: Array(String)}`);   params.environments = input.environments; }
      if (input.models?.length)                    { clauses.push(`t.id IN (
        SELECT DISTINCT trace_id FROM breadcrumb.spans
        WHERE project_id = {projectId: UUID} AND model IN {models: Array(String)}
      )`);                                           params.models = input.models; }

      let hasAiClause = false;
      let searchMode: "ai" | "text" | null = null;
      let aiError: string | null = null;
      if (input.query) {
        try {
          const cacheKey = { projectId: input.projectId, query: input.query };
          const clauseSchema = z.object({ clause: z.string().nullable() });

          // Check cache first (1 hour TTL)
          let aiResult = await cache.get("qw", cacheKey, clauseSchema);
          if (!aiResult) {
            const model = await getAiModel(input.projectId);
            aiResult = await writeSearchQuery({
              model,
              query: input.query,
              activeFilters: clauses.length > 0 ? clauses : undefined,
            });
            await cache.set("qw", cacheKey, aiResult, 60 * 60 * 1000);
          }

          if (aiResult.clause) {
            clauses.push(aiResult.clause);
            hasAiClause = true;
          }
          searchMode = "ai";
        } catch (err) {
          // Fall back to text search on trace input/output
          clauses.push(`t.id IN (
            SELECT DISTINCT trace_id FROM breadcrumb.spans
            WHERE project_id = {projectId: UUID}
              AND (input ilike {searchText: String} OR output ilike {searchText: String} OR name ilike {searchText: String})
          )`);
          params.searchText = `%${input.query}%`;
          searchMode = "text";
          aiError = err instanceof Error ? err.message : "Unknown AI provider error";
        }
      }

      const whereStr = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

      const sql = `
        SELECT
          t.id,
          t.name,
          t.status,
          t.status_message,
          t.start_time,
          COALESCE(t.end_time, r.max_end_time)               AS end_time,
          t.user_id,
          t.environment,
          coalesce(r.input_tokens, 0)                        AS input_tokens,
          coalesce(r.output_tokens, 0)                       AS output_tokens,
          coalesce(r.input_cost_usd + r.output_cost_usd, 0)  AS cost_usd,
          coalesce(r.span_count, 0)                          AS span_count
        FROM (
          SELECT
            id,
            argMax(name, version)           AS name,
            argMax(status, version)         AS status,
            argMax(status_message, version) AS status_message,
            argMax(start_time, version)     AS start_time,
            argMax(end_time, version)       AS end_time,
            argMax(user_id, version)        AS user_id,
            argMax(environment, version)    AS environment
          FROM breadcrumb.traces
          WHERE project_id = {projectId: UUID}
          GROUP BY id
        ) t
        LEFT JOIN (
          ${ROLLUPS_SUBQUERY("projectId")}
        ) r ON t.id = r.trace_id
        ${whereStr}
        ORDER BY t.start_time DESC
        LIMIT {limit: UInt32} OFFSET {offset: UInt32}
      `;

      // When the WHERE clause includes AI-generated SQL, enforce read-only
      // mode at the ClickHouse session level. This is server-enforced —
      // even if the AI produces destructive SQL, ClickHouse will reject it.
      const result = await clickhouse.query({
        query: sql,
        query_params: params,
        format: "JSONEachRow",
        ...(hasAiClause && { clickhouse_settings: { readonly: "1" } }),
      });

      const rows = (await result.json()) as Array<Record<string, unknown>>;

      return {
        traces: rows.map((r) => ({
          id:            String(r["id"]),
          name:          String(r["name"]),
          status:        String(r["status"]) as "ok" | "error",
          statusMessage: String(r["status_message"] ?? ""),
          startTime:     String(r["start_time"]),
          endTime:       r["end_time"] != null ? String(r["end_time"]) : null,
          userId:        String(r["user_id"] ?? ""),
          environment:   String(r["environment"] ?? ""),
          inputTokens:   Number(r["input_tokens"] ?? 0),
          outputTokens:  Number(r["output_tokens"] ?? 0),
          costUsd:       Number(r["cost_usd"] ?? 0) / 1_000_000,
          spanCount:     Number(r["span_count"] ?? 0),
        })),
        searchMode,
        aiError,
      };
    }),

  // Per-day metrics (traces, cost, errors) for the overview chart.
  dailyMetrics: procedure
    .input(z.object({ projectId: z.string().uuid(), ...filterInput }))
    .query(async ({ input }) => {
      const { whereStr, params } = buildTraceFilters(input);

      const result = await clickhouse.query({
        query: `
          SELECT
            toDate(t.start_time)                AS day,
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
        query_params: params,
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

  // Average cost per trace, broken down by trace name per day.
  dailyCostByName: procedure
    .input(z.object({ projectId: z.string().uuid(), ...filterInput }))
    .query(async ({ input }) => {
      const { whereStr, params } = buildTraceFilters(input);

      const result = await clickhouse.query({
        query: `
          SELECT
            toDate(t.start_time)                           AS day,
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
        query_params: params,
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

  // Per-day quality breakdown: healthy / expensive / failed.
  // "Expensive" = succeeded but cost or duration above the p75 of successful
  // traces in the same date range.  "Failed" = errored.  "Healthy" = the rest.
  qualityTimeline: procedure
    .input(z.object({ projectId: z.string().uuid(), ...filterInput }))
    .query(async ({ input }) => {
      const { whereStr, params } = buildTraceFilters(input);

      // Step 1: compute p75 cost & duration from successful traces in the range
      const threshResult = await clickhouse.query({
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
      const result = await clickhouse.query({
        query: `
          SELECT
            toDate(t.start_time) AS day,
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
        query_params: { ...params, p75Cost, p75Duration },
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

  // Span aggregation grouped by provider + model for the model breakdown table.
  modelBreakdown: procedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        from:   z.string().optional(),
        to:     z.string().optional(),
        models: z.array(z.string()).optional(),
      })
    )
    .query(async ({ input }) => {
      const clauses: string[] = [`project_id = {projectId: UUID}`, `provider != ''`];
      const params: Record<string, unknown> = { projectId: input.projectId };

      if (input.from) { clauses.push(`start_time >= {from: Date}`); params.from = input.from; }
      if (input.to)   { clauses.push(`start_time < {to: Date} + INTERVAL 1 DAY`); params.to = input.to; }
      if (input.models && input.models.length > 0) { clauses.push(`model IN {models: Array(String)}`); params.models = input.models; }

      const result = await clickhouse.query({
        query: `
          SELECT
            provider,
            model,
            count(DISTINCT trace_id)              AS trace_count,
            sum(input_tokens)                     AS input_tokens,
            sum(output_tokens)                    AS output_tokens,
            sum(input_cost_usd + output_cost_usd) AS cost_usd
          FROM breadcrumb.spans
          WHERE ${clauses.join(" AND ")}
          GROUP BY provider, model
          ORDER BY cost_usd DESC
          LIMIT 20
        `,
        query_params: params,
        format: "JSONEachRow",
      });

      const rows = (await result.json()) as Array<Record<string, unknown>>;
      return rows.map((r) => ({
        provider:     String(r["provider"]),
        model:        String(r["model"]),
        traceCount:   Number(r["trace_count"]),
        inputTokens:  Number(r["input_tokens"]),
        outputTokens: Number(r["output_tokens"]),
        costUsd:      Number(r["cost_usd"]) / 1_000_000,
      }));
    }),

  // Top failing spans by error count within the date range.
  topFailingSpans: procedure
    .input(z.object({ projectId: z.string().uuid(), ...filterInput }))
    .query(async ({ input }) => {
      const clauses: string[] = [`s.project_id = {projectId: UUID}`];
      const params: Record<string, unknown> = { projectId: input.projectId };

      if (input.from) {
        clauses.push(`s.start_time >= {from: Date}`);
        params.from = input.from;
      }
      if (input.to) {
        clauses.push(`s.start_time < {to: Date} + INTERVAL 1 DAY`);
        params.to = input.to;
      }

      const result = await clickhouse.query({
        query: `
          SELECT
            s.name                                           AS span_name,
            count()                                          AS total,
            countIf(s.status = 'error')                      AS errors,
            round(countIf(s.status = 'error') / count() * 100, 1) AS error_rate
          FROM breadcrumb.spans s
          WHERE ${clauses.join(" AND ")}
          GROUP BY span_name
          HAVING errors > 0
          ORDER BY errors DESC
          LIMIT 10
        `,
        query_params: params,
        format: "JSONEachRow",
      });

      const rows = (await result.json()) as Array<Record<string, unknown>>;
      return rows.map((r) => ({
        name:      String(r["span_name"]),
        total:     Number(r["total"]),
        errors:    Number(r["errors"]),
        errorRate: Number(r["error_rate"]),
      }));
    }),

  // Top slowest spans by average duration within the date range.
  topSlowestSpans: procedure
    .input(z.object({ projectId: z.string().uuid(), ...filterInput }))
    .query(async ({ input }) => {
      const clauses: string[] = [`s.project_id = {projectId: UUID}`];
      const params: Record<string, unknown> = { projectId: input.projectId };

      if (input.from) {
        clauses.push(`s.start_time >= {from: Date}`);
        params.from = input.from;
      }
      if (input.to) {
        clauses.push(`s.start_time < {to: Date} + INTERVAL 1 DAY`);
        params.to = input.to;
      }

      const result = await clickhouse.query({
        query: `
          SELECT
            s.name                                           AS span_name,
            count()                                          AS total,
            avg(
              toInt64(toUnixTimestamp64Milli(s.end_time)) - toInt64(toUnixTimestamp64Milli(s.start_time))
            )                                                AS avg_duration_ms,
            quantile(0.95)(
              toInt64(toUnixTimestamp64Milli(s.end_time)) - toInt64(toUnixTimestamp64Milli(s.start_time))
            )                                                AS p95_duration_ms
          FROM breadcrumb.spans s
          WHERE ${clauses.join(" AND ")}
            AND s.end_time > s.start_time
          GROUP BY span_name
          ORDER BY avg_duration_ms DESC
          LIMIT 10
        `,
        query_params: params,
        format: "JSONEachRow",
      });

      const rows = (await result.json()) as Array<Record<string, unknown>>;
      return rows.map((r) => ({
        name:          String(r["span_name"]),
        total:         Number(r["total"]),
        avgDurationMs: Number(r["avg_duration_ms"]),
        p95DurationMs: Number(r["p95_duration_ms"]),
      }));
    }),

  // Distinct environment values for the filter dropdown.
  environments: procedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ input }) => {
      const result = await clickhouse.query({
        query: `
          SELECT DISTINCT env
          FROM (
            SELECT argMax(environment, version) AS env
            FROM breadcrumb.traces
            WHERE project_id = {projectId: UUID}
            GROUP BY id
          )
          WHERE env != ''
          ORDER BY env ASC
        `,
        query_params: { projectId: input.projectId },
        format: "JSONEachRow",
      });

      const rows = (await result.json()) as Array<Record<string, unknown>>;
      return rows.map((r) => String(r["env"]));
    }),

  // Distinct model values for the filter dropdown.
  models: procedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ input }) => {
      const result = await clickhouse.query({
        query: `
          SELECT DISTINCT model
          FROM breadcrumb.spans
          WHERE project_id = {projectId: UUID}
            AND model != ''
          ORDER BY model ASC
          LIMIT 100
        `,
        query_params: { projectId: input.projectId },
        format: "JSONEachRow",
      });

      const rows = (await result.json()) as Array<Record<string, unknown>>;
      return rows.map((r) => String(r["model"]));
    }),

  // Distinct trace name values for the multiselect combobox.
  names: procedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ input }) => {
      const result = await clickhouse.query({
        query: `
          SELECT DISTINCT name
          FROM (
            SELECT argMax(name, version) AS name
            FROM breadcrumb.traces
            WHERE project_id = {projectId: UUID}
            GROUP BY id
          )
          WHERE name != ''
          ORDER BY name ASC
          LIMIT 500
        `,
        query_params: { projectId: input.projectId },
        format: "JSONEachRow",
      });

      const rows = (await result.json()) as Array<Record<string, unknown>>;
      return rows.map((r) => String(r["name"]));
    }),

  // Traces grouped by day — kept for backward compatibility.
  dailyCount: procedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        days: z.number().int().min(1).max(90).default(30),
      })
    )
    .query(async ({ input }) => {
      const result = await clickhouse.query({
        query: `
          SELECT
            toDate(start_time) AS day,
            count()            AS trace_count
          FROM (
            SELECT id, argMax(start_time, version) AS start_time
            FROM breadcrumb.traces
            WHERE project_id = {projectId: UUID}
            GROUP BY id
          )
          WHERE start_time >= today() - {days: UInt32} + 1
          GROUP BY day
          ORDER BY day ASC
        `,
        query_params: { projectId: input.projectId, days: input.days },
        format: "JSONEachRow",
      });

      const rows = (await result.json()) as Array<Record<string, unknown>>;
      return rows.map((r) => ({ date: String(r["day"]), count: Number(r["trace_count"]) }));
    }),

  // Lightweight spans from recent traces of a given name — for aggregate insights.
  spanSample: procedure
    .input(z.object({
      projectId:  z.string().uuid(),
      traceName:  z.string(),
      traceLimit: z.number().int().min(1).max(50).default(20),
    }))
    .query(async ({ input }) => {
      const traceResult = await clickhouse.query({
        query: `
          SELECT id
          FROM (
            SELECT id, argMax(name, version) AS name, argMax(start_time, version) AS start_time
            FROM breadcrumb.traces
            WHERE project_id = {projectId: UUID}
            GROUP BY id
          )
          WHERE name = {traceName: String}
          ORDER BY start_time DESC
          LIMIT {traceLimit: UInt32}
        `,
        query_params: { projectId: input.projectId, traceName: input.traceName, traceLimit: input.traceLimit },
        format: "JSONEachRow",
      });

      const traceRows = (await traceResult.json()) as Array<Record<string, unknown>>;
      const traceIds = traceRows.map(r => String(r["id"]));

      if (traceIds.length === 0) return { traceCount: 0, spans: [] as Array<{ id: string; traceId: string; parentSpanId: string; name: string; type: string; status: "ok" | "error"; startTime: string; endTime: string }> };

      const spanResult = await clickhouse.query({
        query: `
          SELECT
            id, trace_id, parent_span_id, name, type, status,
            start_time, end_time
          FROM breadcrumb.spans
          WHERE project_id = {projectId: UUID}
            AND trace_id IN {traceIds: Array(String)}
          ORDER BY start_time ASC
        `,
        query_params: { projectId: input.projectId, traceIds },
        format: "JSONEachRow",
      });

      const spanRows = (await spanResult.json()) as Array<Record<string, unknown>>;

      return {
        traceCount: traceIds.length,
        spans: spanRows.map(r => ({
          id:           String(r["id"]),
          traceId:      String(r["trace_id"]),
          parentSpanId: String(r["parent_span_id"] ?? ""),
          name:         String(r["name"]),
          type:         String(r["type"]),
          status:       String(r["status"]) as "ok" | "error",
          startTime:    String(r["start_time"]),
          endTime:      String(r["end_time"]),
        })),
      };
    }),

  // Most common execution flow (edges between parent→child spans) across recent traces.
  happyPath: procedure
    .input(z.object({
      projectId:  z.string().uuid(),
      traceName:  z.string(),
      traceLimit: z.number().int().min(1).max(200).default(50),
    }))
    .query(async ({ input }) => {
      const result = await clickhouse.query({
        query: `
          WITH
            trace_ids AS (
              SELECT id FROM (
                SELECT id, argMax(name, version) AS name, argMax(start_time, version) AS st
                FROM breadcrumb.traces
                WHERE project_id = {projectId: UUID}
                GROUP BY id
              )
              WHERE name = {traceName: String}
              ORDER BY st DESC
              LIMIT {traceLimit: UInt32}
            ),
            all_spans AS (
              SELECT id, trace_id, parent_span_id, name, type, start_time
              FROM breadcrumb.spans
              WHERE project_id = {projectId: UUID}
                AND trace_id IN (SELECT id FROM trace_ids)
            ),
            root_ordered AS (
              SELECT trace_id, name, type,
                row_number() OVER (PARTITION BY trace_id ORDER BY start_time) AS rn
              FROM all_spans
              WHERE parent_span_id = ''
            )
          SELECT parent_name, parent_type, child_name, child_type,
                 sum(tc) AS trace_count
          FROM (
            -- 1. Parent-child edges (spans with an explicit parent)
            SELECT
              parent.name                        AS parent_name,
              parent.type                        AS parent_type,
              child.name                         AS child_name,
              child.type                         AS child_type,
              count(DISTINCT child.trace_id)     AS tc
            FROM all_spans child
            JOIN all_spans parent
              ON child.parent_span_id = parent.id
              AND child.trace_id = parent.trace_id
            WHERE child.parent_span_id != ''
            GROUP BY parent_name, parent_type, child_name, child_type

            UNION ALL

            -- 2. Sequential edges between root spans (ordered by start_time)
            SELECT
              r1.name                            AS parent_name,
              r1.type                            AS parent_type,
              r2.name                            AS child_name,
              r2.type                            AS child_type,
              count(DISTINCT r1.trace_id)        AS tc
            FROM root_ordered r1
            JOIN root_ordered r2
              ON r1.trace_id = r2.trace_id AND r2.rn = r1.rn + 1
            GROUP BY parent_name, parent_type, child_name, child_type
          )
          GROUP BY parent_name, parent_type, child_name, child_type
          ORDER BY trace_count DESC
        `,
        query_params: {
          projectId: input.projectId,
          traceName: input.traceName,
          traceLimit: input.traceLimit,
        },
        format: "JSONEachRow",
      });

      const rows = (await result.json()) as Array<Record<string, unknown>>;

      // Get total trace count from a separate lightweight query
      const countResult = await clickhouse.query({
        query: `
          SELECT count() AS cnt FROM (
            SELECT id FROM (
              SELECT id, argMax(name, version) AS name, argMax(start_time, version) AS st
              FROM breadcrumb.traces
              WHERE project_id = {projectId: UUID}
              GROUP BY id
            )
            WHERE name = {traceName: String}
            ORDER BY st DESC
            LIMIT {traceLimit: UInt32}
          )
        `,
        query_params: {
          projectId: input.projectId,
          traceName: input.traceName,
          traceLimit: input.traceLimit,
        },
        format: "JSONEachRow",
      });
      const countRows = (await countResult.json()) as Array<Record<string, unknown>>;
      const totalTraces = Number(countRows[0]?.["cnt"] ?? 0);

      return {
        totalTraces,
        edges: rows.map((r) => ({
          parentName:  String(r["parent_name"]),
          parentType:  String(r["parent_type"]),
          childName:   String(r["child_name"]),
          childType:   String(r["child_type"]),
          traceCount:  Number(r["trace_count"]),
        })),
      };
    }),

  // All spans for a single trace, ordered by start_time.
  spans: procedure
    .input(z.object({ projectId: z.string().uuid(), traceId: z.string() }))
    .query(async ({ input }) => {
      const result = await clickhouse.query({
        query: `
          SELECT
            id, parent_span_id, name, type, status, status_message,
            start_time, end_time, provider, model,
            input_tokens, output_tokens, input_cost_usd, output_cost_usd,
            input, output, metadata
          FROM breadcrumb.spans
          WHERE project_id = {projectId: UUID}
            AND trace_id = {traceId: String}
          ORDER BY start_time ASC
        `,
        query_params: { projectId: input.projectId, traceId: input.traceId },
        format: "JSONEachRow",
      });

      const rows = (await result.json()) as Array<Record<string, unknown>>;

      return rows.map((r) => ({
        id:            String(r["id"]),
        parentSpanId:  String(r["parent_span_id"] ?? ""),
        name:          String(r["name"]),
        type:          String(r["type"]),
        status:        String(r["status"]) as "ok" | "error",
        statusMessage: String(r["status_message"] ?? ""),
        startTime:     String(r["start_time"]),
        endTime:       String(r["end_time"]),
        provider:      String(r["provider"] ?? ""),
        model:         String(r["model"] ?? ""),
        inputTokens:   Number(r["input_tokens"] ?? 0),
        outputTokens:  Number(r["output_tokens"] ?? 0),
        inputCostUsd:  Number(r["input_cost_usd"] ?? 0) / 1_000_000,
        outputCostUsd: Number(r["output_cost_usd"] ?? 0) / 1_000_000,
        input:         toStr(r["input"]),
        output:        toStr(r["output"]),
        metadata:      toStr(r["metadata"]),
      }));
    }),
});
