import { z } from "zod";
import { router, projectViewerProcedure } from "../../../trpc.js";
import { readonlyClickhouse } from "../../../shared/db/clickhouse.js";
import { filterInput } from "../../../services/traces/helpers.js";

export const insightsRouter = router({
  spanSample: projectViewerProcedure
    .input(z.object({
      projectId:  z.string().uuid(),
      traceName:  z.string(),
      from:       z.string().optional(),
      to:         z.string().optional(),
    }))
    .query(async ({ input }) => {
      const dateFilter = input.from && input.to
        ? `AND start_time >= {from: String} AND start_time < {to: String} + INTERVAL 1 DAY`
        : "";

      const traceResult = await readonlyClickhouse.query({
        query: `
          SELECT id
          FROM (
            SELECT id, argMax(name, version) AS name, argMax(start_time, version) AS start_time
            FROM breadcrumb.traces
            WHERE project_id = {projectId: UUID}
            GROUP BY id
          )
          WHERE name = {traceName: String}
            ${dateFilter}
          LIMIT 500
        `,
        query_params: { projectId: input.projectId, traceName: input.traceName, from: input.from ?? "", to: input.to ?? "" },
        format: "JSONEachRow",
      });

      const traceRows = (await traceResult.json()) as Array<Record<string, unknown>>;
      const traceIds = traceRows.map(r => String(r["id"]));

      if (traceIds.length === 0) return { traceCount: 0, spans: [] as Array<{ id: string; traceId: string; parentSpanId: string; name: string; type: string; status: "ok" | "error"; startTime: string; endTime: string }> };

      const spanResult = await readonlyClickhouse.query({
        query: `
          SELECT
            id, trace_id, parent_span_id, name, type, status,
            start_time, end_time
          FROM breadcrumb.spans
          WHERE project_id = {projectId: UUID}
            AND trace_id IN {traceIds: Array(String)}
          ORDER BY start_time ASC
          LIMIT 50000
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

  loopbackRate: projectViewerProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      traceName: z.string(),
      from:      z.string().optional(),
      to:        z.string().optional(),
      sortBy:    z.enum(["rate", "loopbacks"]).default("rate"),
    }))
    .query(async ({ input }) => {
      const dateFilter = input.from && input.to
        ? `AND start_time >= {from: String} AND start_time < {to: String} + INTERVAL 1 DAY`
        : "";

      const baseParams: Record<string, unknown> = {
        projectId: input.projectId,
        traceName: input.traceName,
        from: input.from ?? "",
        to: input.to ?? "",
      };

      // Query 1: loopback rates (top 10)
      const rateResult = await readonlyClickhouse.query({
        query: `
          WITH
          filtered_traces AS (
            SELECT id, start_time,
              ROW_NUMBER() OVER (ORDER BY start_time, id) AS trace_seq
            FROM (
              SELECT id, argMax(name, version) AS name, argMax(start_time, version) AS start_time
              FROM breadcrumb.traces WHERE project_id = {projectId: UUID} GROUP BY id
            )
            WHERE name = {traceName: String} ${dateFilter}
          ),
          span_trace AS (
            SELECT s.name AS span_name, any(s.type) AS span_type, s.trace_id, ft.trace_seq,
              min(s.start_time) AS span_first_start
            FROM breadcrumb.spans s
            INNER JOIN filtered_traces ft ON s.trace_id = ft.id
            WHERE s.project_id = {projectId: UUID} AND s.type != 'step'
            GROUP BY s.name, s.trace_id, ft.trace_seq
          ),
          with_prev AS (
            SELECT *, lagInFrame(trace_seq, 1, 0)
              OVER (PARTITION BY span_name ORDER BY trace_seq) AS prev_seq
            FROM span_trace
          )
          SELECT span_name, span_type,
            count() AS appearances,
            sum(if(prev_seq > 0 AND trace_seq - prev_seq > 1, 1, 0)) AS loopbacks,
            loopbacks / appearances AS rate,
            (SELECT count() FROM filtered_traces) AS total_traces
          FROM with_prev
          GROUP BY span_name, span_type
          HAVING loopbacks > 0
          ORDER BY ${input.sortBy === "loopbacks" ? "loopbacks" : "rate"} DESC LIMIT 10
        `,
        query_params: baseParams,
        format: "JSONEachRow",
      });

      const rateRows = (await rateResult.json()) as Array<Record<string, unknown>>;

      if (!rateRows.length) {
        return { totalTraces: 0, spans: [] as Array<{ name: string; type: string; appearances: number; loopbacks: number; rate: number; triggers: Array<{ name: string; pct: number }> }> };
      }

      const totalTraces = Number(rateRows[0]["total_traces"] ?? 0);
      const spanNames = rateRows.map(r => String(r["span_name"]));

      // Query 2: trigger breakdown for the top loopback span names
      const triggerResult = await readonlyClickhouse.query({
        query: `
          WITH
          filtered_traces AS (
            SELECT id, start_time,
              ROW_NUMBER() OVER (ORDER BY start_time, id) AS trace_seq
            FROM (
              SELECT id, argMax(name, version) AS name, argMax(start_time, version) AS start_time
              FROM breadcrumb.traces WHERE project_id = {projectId: UUID} GROUP BY id
            )
            WHERE name = {traceName: String} ${dateFilter}
          ),
          span_trace AS (
            SELECT s.name AS span_name, s.trace_id, ft.trace_seq,
              min(s.start_time) AS span_first_start
            FROM breadcrumb.spans s
            INNER JOIN filtered_traces ft ON s.trace_id = ft.id
            WHERE s.project_id = {projectId: UUID} AND s.type != 'step'
            GROUP BY s.name, s.trace_id, ft.trace_seq
          ),
          with_prev AS (
            SELECT *, lagInFrame(trace_seq, 1, 0)
              OVER (PARTITION BY span_name ORDER BY trace_seq) AS prev_seq
            FROM span_trace
          ),
          loopback_traces AS (
            SELECT span_name, trace_id, span_first_start FROM with_prev
            WHERE prev_seq > 0 AND trace_seq - prev_seq > 1
              AND span_name IN {spanNames: Array(String)}
          ),
          trigger_per_loopback AS (
            SELECT lb.span_name AS loopback_span, lb.trace_id,
              argMax(s.name, s.start_time) AS trigger_name
            FROM loopback_traces lb
            INNER JOIN breadcrumb.spans s ON s.trace_id = lb.trace_id
            WHERE s.project_id = {projectId: UUID} AND s.type != 'step'
              AND s.name != lb.span_name AND s.start_time < lb.span_first_start
            GROUP BY lb.span_name, lb.trace_id
          )
          SELECT loopback_span, trigger_name, count() AS trigger_count
          FROM trigger_per_loopback
          GROUP BY loopback_span, trigger_name
          ORDER BY loopback_span, trigger_count DESC
        `,
        query_params: { ...baseParams, spanNames },
        format: "JSONEachRow",
      });

      const triggerRows = (await triggerResult.json()) as Array<Record<string, unknown>>;

      // Build trigger map: loopback_span -> Array<{name, count}>
      const triggerMap = new Map<string, Array<{ name: string; count: number }>>();
      for (const r of triggerRows) {
        const span = String(r["loopback_span"]);
        if (!triggerMap.has(span)) triggerMap.set(span, []);
        triggerMap.get(span)!.push({
          name: String(r["trigger_name"]),
          count: Number(r["trigger_count"]),
        });
      }

      const spans = rateRows.map(r => {
        const name = String(r["span_name"]);
        const loopbacks = Number(r["loopbacks"]);
        const triggers = triggerMap.get(name) ?? [];
        const triggerTotal = triggers.reduce((sum, t) => sum + t.count, 0);
        return {
          name,
          type: String(r["span_type"]),
          appearances: Number(r["appearances"]),
          loopbacks,
          rate: Number(r["rate"]),
          triggers: triggers.map(t => ({
            name: t.name,
            pct: triggerTotal > 0 ? t.count / triggerTotal : 0,
          })),
        };
      });

      return { totalTraces, spans };
    }),

  topFailingSpans: projectViewerProcedure
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

      const result = await readonlyClickhouse.query({
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

  topSlowestSpans: projectViewerProcedure
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

      const result = await readonlyClickhouse.query({
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

  modelBreakdown: projectViewerProcedure
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

      const result = await readonlyClickhouse.query({
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
});
