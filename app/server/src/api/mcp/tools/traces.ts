import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readonlyClickhouse } from "../../../shared/db/clickhouse.js";
import { calcDuration, toUtc, truncateSpanField, normMetadata } from "../../../services/mcp/helpers.js";
import { getUserProjectIds, buildProjectCondition, ROLLUPS_JOIN, EFFECTIVE_END } from "../helpers.js";

export function registerTracesTools(server: McpServer, userId: string) {
  server.tool(
    "list_traces",
    "List traces with optional filters. Returns trace metadata including status, cost, tokens, and duration. Searches across all accessible projects when no project_id is given.",
    {
      project_id: z.string().optional().describe("Filter by project ID (optional)"),
      limit: z.number().int().min(1).max(100).default(20).describe("Maximum number of traces to return"),
      offset: z.number().int().min(0).default(0).describe("Number of traces to skip for pagination"),
      name: z.string().optional().describe("Case-insensitive substring match against trace name (optional)"),
      status: z.enum(["ok", "error"]).optional().describe("Filter by trace status"),
      environment: z.string().optional().describe("Filter by environment (e.g. 'production', 'development')"),
      user_id: z.string().optional().describe("Filter by user ID"),
      date_from: z.string().optional().describe("ISO 8601 UTC date string — only return traces after this date"),
      date_to: z.string().optional().describe("ISO 8601 UTC date string — only return traces before this date"),
    },
    async ({ project_id, limit, offset, name, status, environment, user_id, date_from, date_to }) => {
      const projectIds = project_id
        ? [project_id]
        : await getUserProjectIds(userId);

      if (!projectIds.length) {
        return { content: [{ type: "text", text: JSON.stringify([], null, 2) }] };
      }

      const baseParams: Record<string, unknown> = { limit, offset };
      const { condition: projectCondition, params } = buildProjectCondition(projectIds, baseParams);

      const conditions: string[] = [projectCondition];

      if (status) {
        conditions.push(`status = {status: String}`);
        params["status"] = status;
      }
      if (environment) {
        conditions.push(`environment = {environment: String}`);
        params["environment"] = environment;
      }
      if (user_id) {
        conditions.push(`user_id = {userId: String}`);
        params["userId"] = user_id;
      }
      if (date_from) {
        conditions.push(`start_time >= {dateFrom: DateTime}`);
        params["dateFrom"] = date_from;
      }
      if (date_to) {
        conditions.push(`start_time <= {dateTo: DateTime}`);
        params["dateTo"] = date_to;
      }

      const where = conditions.join(" AND ");

      // Name filter is applied after the deduplication subquery
      const nameFilter = name
        ? `WHERE lower(t.name) LIKE {namePattern: String}`
        : "";
      if (name) params["namePattern"] = `%${name.toLowerCase()}%`;

      const result = await readonlyClickhouse.query({
        query: `
          SELECT
            t.id,
            t.name,
            t.status,
            t.status_message,
            t.start_time,
            ${EFFECTIVE_END}                                       AS end_time,
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
            WHERE ${where}
            GROUP BY id
          ) t
          ${ROLLUPS_JOIN(projectCondition)}
          ${nameFilter}
          ORDER BY t.start_time DESC
          LIMIT {limit: UInt32}
          OFFSET {offset: UInt32}
        `,
        query_params: params,
        format: "JSONEachRow",
      });

      const rows = (await result.json()) as Array<Record<string, unknown>>;
      const traces = rows.map((r) => {
        const startTime = toUtc(String(r["start_time"]))!;
        const endTime = toUtc(r["end_time"] != null ? String(r["end_time"]) : null);
        return {
          id: String(r["id"]),
          name: String(r["name"]),
          status: String(r["status"]),
          statusMessage: String(r["status_message"] ?? "") || null,
          startTime,
          endTime,
          durationMs: calcDuration(startTime, endTime),
          userId: String(r["user_id"] ?? "") || null,
          environment: String(r["environment"] ?? "") || null,
          inputTokens: Number(r["input_tokens"] ?? 0),
          outputTokens: Number(r["output_tokens"] ?? 0),
          costUsd: Number(r["cost_usd"] ?? 0) / 1_000_000,
          spanCount: Number(r["span_count"] ?? 0),
        };
      });

      return {
        content: [{ type: "text", text: JSON.stringify(traces, null, 2) }],
      };
    }
  );

  server.tool(
    "get_trace",
    "Get a single trace with all its spans, including full input/output text for each span. Searches across all accessible projects when no project_id is given.",
    {
      trace_id: z.string().describe("The trace ID to retrieve"),
      project_id: z.string().optional().describe("The project ID (optional — speeds up lookup if provided)"),
    },
    async ({ trace_id, project_id }) => {
      const projectIds = project_id
        ? [project_id]
        : await getUserProjectIds(userId);

      if (!projectIds.length) {
        return { content: [{ type: "text", text: `Trace ${trace_id} not found.` }] };
      }

      const { condition: projectCondition, params: baseParams } = buildProjectCondition(projectIds, {});
      const traceParams = { ...baseParams, traceId: trace_id };

      const [traceResult, spansResult] = await Promise.all([
        readonlyClickhouse.query({
          query: `
            SELECT
              t.id,
              t.name,
              t.status,
              t.status_message,
              t.start_time,
              ${EFFECTIVE_END} AS end_time,
              t.user_id,
              t.environment
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
              WHERE ${projectCondition}
                AND id = {traceId: String}
              GROUP BY id
            ) t
            LEFT JOIN (
              SELECT
                trace_id,
                max(max_end_time) AS max_end_time
              FROM breadcrumb.trace_rollups
              WHERE ${projectCondition}
                AND trace_id = {traceId: String}
              GROUP BY trace_id
            ) r ON t.id = r.trace_id
          `,
          query_params: traceParams,
          format: "JSONEachRow",
        }),
        readonlyClickhouse.query({
          query: `
            SELECT
              id,
              parent_span_id,
              name,
              type,
              status,
              status_message,
              start_time,
              end_time,
              provider,
              model,
              input_tokens,
              output_tokens,
              input_cost_usd,
              output_cost_usd,
              input,
              output,
              metadata
            FROM breadcrumb.spans
            WHERE ${projectCondition}
              AND trace_id = {traceId: String}
            ORDER BY start_time ASC
          `,
          query_params: traceParams,
          format: "JSONEachRow",
        }),
      ]);

      const traceRows = (await traceResult.json()) as Array<Record<string, unknown>>;
      const spanRows = (await spansResult.json()) as Array<Record<string, unknown>>;

      if (!traceRows.length) {
        return {
          content: [{ type: "text", text: `Trace ${trace_id} not found.` }],
        };
      }

      const tr = traceRows[0];
      const trStartTime = toUtc(String(tr["start_time"]))!;
      const trEndTime = toUtc(tr["end_time"] != null ? String(tr["end_time"]) : null);

      const trace = {
        id: String(tr["id"]),
        name: String(tr["name"]),
        status: String(tr["status"]),
        statusMessage: String(tr["status_message"] ?? "") || null,
        startTime: trStartTime,
        endTime: trEndTime,
        durationMs: calcDuration(trStartTime, trEndTime),
        userId: String(tr["user_id"] ?? "") || null,
        environment: String(tr["environment"] ?? "") || null,
        spans: spanRows.map((r) => {
          const spanStart = toUtc(String(r["start_time"]))!;
          const spanEnd = toUtc(String(r["end_time"]))!;
          const input = String(r["input"] ?? "") || null;
          const output = String(r["output"] ?? "") || null;
          return {
            id: String(r["id"]),
            parentSpanId: String(r["parent_span_id"] ?? "") || null,
            name: String(r["name"]),
            type: String(r["type"]),
            status: String(r["status"]),
            statusMessage: String(r["status_message"] ?? "") || null,
            startTime: spanStart,
            endTime: spanEnd,
            durationMs: calcDuration(spanStart, spanEnd),
            provider: String(r["provider"] ?? "") || null,
            model: String(r["model"] ?? "") || null,
            inputTokens: Number(r["input_tokens"] ?? 0),
            outputTokens: Number(r["output_tokens"] ?? 0),
            inputCostUsd: Number(r["input_cost_usd"] ?? 0) / 1_000_000,
            outputCostUsd: Number(r["output_cost_usd"] ?? 0) / 1_000_000,
            input: truncateSpanField(input, "input"),
            output: truncateSpanField(output, "output"),
            metadata: normMetadata(r["metadata"]),
          };
        }),
      };

      return {
        content: [{ type: "text", text: JSON.stringify(trace, null, 2) }],
      };
    }
  );

  server.tool(
    "find_outliers",
    "Find the top N traces with the highest cost, duration, or token usage. Searches across all accessible projects when no project_id is given.",
    {
      metric: z.enum(["cost", "duration", "tokens"]).describe("The metric to sort by"),
      limit: z.number().int().min(1).max(50).default(10).describe("Number of outlier traces to return"),
      project_id: z.string().optional().describe("Limit to a specific project ID (optional)"),
    },
    async ({ metric, limit, project_id }) => {
      const projectIds = project_id
        ? [project_id]
        : await getUserProjectIds(userId);

      if (!projectIds.length) {
        return { content: [{ type: "text", text: JSON.stringify([], null, 2) }] };
      }

      const { condition: projectCondition, params } = buildProjectCondition(projectIds, { limit });

      const orderBy =
        metric === "cost"     ? "cost_usd DESC" :
        metric === "duration" ? `dateDiff('millisecond', t.start_time, ${EFFECTIVE_END}) DESC` :
                                "(input_tokens + output_tokens) DESC";

      const durationFilter = metric === "duration"
        ? `HAVING isNotNull(${EFFECTIVE_END})`
        : "";

      const result = await readonlyClickhouse.query({
        query: `
          SELECT
            t.id,
            t.name,
            t.status,
            t.start_time,
            ${EFFECTIVE_END}                                      AS end_time,
            t.user_id,
            t.environment,
            coalesce(r.input_tokens, 0)                       AS input_tokens,
            coalesce(r.output_tokens, 0)                      AS output_tokens,
            coalesce(r.input_cost_usd + r.output_cost_usd, 0) AS cost_usd
          FROM (
            SELECT
              id,
              argMax(name, version)        AS name,
              argMax(status, version)      AS status,
              argMax(start_time, version)  AS start_time,
              argMax(end_time, version)    AS end_time,
              argMax(user_id, version)     AS user_id,
              argMax(environment, version) AS environment
            FROM breadcrumb.traces
            WHERE ${projectCondition}
            GROUP BY id
          ) t
          ${ROLLUPS_JOIN(projectCondition)}
          ${durationFilter}
          ORDER BY ${orderBy}
          LIMIT {limit: UInt32}
        `,
        query_params: params,
        format: "JSONEachRow",
      });

      const rows = (await result.json()) as Array<Record<string, unknown>>;
      const traces = rows.map((r) => {
        const startTime = toUtc(String(r["start_time"]))!;
        const endTime = toUtc(r["end_time"] != null ? String(r["end_time"]) : null);
        return {
          id: String(r["id"]),
          name: String(r["name"]),
          status: String(r["status"]),
          startTime,
          endTime,
          durationMs: calcDuration(startTime, endTime),
          userId: String(r["user_id"] ?? "") || null,
          environment: String(r["environment"] ?? "") || null,
          inputTokens: Number(r["input_tokens"] ?? 0),
          outputTokens: Number(r["output_tokens"] ?? 0),
          costUsd: Number(r["cost_usd"] ?? 0) / 1_000_000,
        };
      });

      return {
        content: [{ type: "text", text: JSON.stringify(traces, null, 2) }],
      };
    }
  );
}
