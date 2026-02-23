import { z } from "zod";
import { router, procedure } from "../trpc.js";
import { clickhouse } from "../../db/clickhouse.js";

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
  environment?: string;
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
  if (input.environment) {
    clauses.push(`t.environment = {environment: String}`);
    params.environment = input.environment;
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
  from:        z.string().optional(),  // YYYY-MM-DD
  to:          z.string().optional(),  // YYYY-MM-DD
  environment: z.string().optional(),
  models:      z.array(z.string()).optional(),
  names:       z.array(z.string()).optional(),
};

export const tracesRouter = router({
  // Aggregated stats for the project dashboard header cards.
  stats: procedure
    .input(z.object({ projectId: z.string().uuid(), ...filterInput }))
    .query(async ({ input }) => {
      const { whereStr, params } = buildTraceFilters(input);

      const result = await clickhouse.query({
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
          ${whereStr}
        `,
        query_params: params,
        format: "JSONEachRow",
      });

      const rows = (await result.json()) as Array<Record<string, unknown>>;
      const row = rows[0] ?? {};
      const traceCount = Number(row["trace_count"] ?? 0);
      const errorCount = Number(row["error_count"] ?? 0);

      return {
        traceCount,
        totalCostUsd:  Number(row["total_cost_usd"] ?? 0) / 1_000_000,
        avgDurationMs: Number(row["avg_duration_ms"] ?? 0),
        errorCount,
        errorRate: traceCount > 0 ? errorCount / traceCount : 0,
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
        environment: z.string().optional(),
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
      if (input.environment)                       { clauses.push(`t.environment = {environment: String}`);             params.environment = input.environment; }
      if (input.models?.length)                    { clauses.push(`t.id IN (
        SELECT DISTINCT trace_id FROM breadcrumb.spans
        WHERE project_id = {projectId: UUID} AND model IN {models: Array(String)}
      )`);                                           params.models = input.models; }

      const whereStr = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

      const result = await clickhouse.query({
        query: `
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
        `,
        query_params: params,
        format: "JSONEachRow",
      });

      const rows = (await result.json()) as Array<Record<string, unknown>>;

      return rows.map((r) => ({
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
      }));
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
            sum(coalesce(r.total_cost_usd, 0))  AS total_cost_usd
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
          GROUP BY day
          ORDER BY day ASC
        `,
        query_params: params,
        format: "JSONEachRow",
      });

      const rows = (await result.json()) as Array<Record<string, unknown>>;
      return rows.map((r) => ({
        date:    String(r["day"]),
        traces:  Number(r["trace_count"]),
        errors:  Number(r["error_count"]),
        costUsd: Number(r["total_cost_usd"]) / 1_000_000,
      }));
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
