import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readonlyClickhouse } from "../../../shared/db/clickhouse.js";
import { calcDuration, toUtc, normMetadata } from "../../../services/mcp/helpers.js";
import { getUserProjectIds, buildProjectCondition } from "../helpers.js";

export function registerSpansTools(server: McpServer, userId: string) {
  server.tool(
    "get_span",
    "Get a single span by ID, including full input/output content.",
    {
      span_id: z.string().describe("The span ID to retrieve"),
      project_id: z.string().optional().describe("The project ID (optional — speeds up lookup if provided)"),
    },
    async ({ span_id, project_id }) => {
      const projectIds = project_id
        ? [project_id]
        : await getUserProjectIds(userId);

      if (!projectIds.length) {
        return { content: [{ type: "text", text: `Span ${span_id} not found.` }] };
      }

      const { condition: projectCondition, params } = buildProjectCondition(projectIds, {
        spanId: span_id,
      });

      const result = await readonlyClickhouse.query({
        query: `
          SELECT
            id,
            trace_id,
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
            AND id = {spanId: String}
          LIMIT 1
        `,
        query_params: params,
        format: "JSONEachRow",
      });

      const rows = (await result.json()) as Array<Record<string, unknown>>;

      if (!rows.length) {
        return { content: [{ type: "text", text: `Span ${span_id} not found.` }] };
      }

      const r = rows[0];
      const spanStart = toUtc(String(r["start_time"]))!;
      const spanEnd = toUtc(String(r["end_time"]))!;

      const span = {
        id: String(r["id"]),
        traceId: String(r["trace_id"]),
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
        input: String(r["input"] ?? "") || null,   // full content — no truncation
        output: String(r["output"] ?? "") || null,
        metadata: normMetadata(r["metadata"]),
      };

      return {
        content: [{ type: "text", text: JSON.stringify(span, null, 2) }],
      };
    }
  );

  server.tool(
    "list_spans",
    "Query spans across traces with optional filters. Useful for finding all spans of a specific type, model, provider, or status. Searches across all accessible projects when no project_id is given.",
    {
      project_id: z.string().optional().describe("Filter by project ID (optional)"),
      trace_id: z.string().optional().describe("Filter to spans belonging to a specific trace"),
      type: z.enum(["llm", "tool", "retrieval", "step", "custom"]).optional().describe("Filter by span type"),
      model: z.string().optional().describe("Filter by model name (exact match)"),
      provider: z.string().optional().describe("Filter by provider name (exact match, e.g. 'openai', 'anthropic')"),
      status: z.enum(["ok", "error"]).optional().describe("Filter by span status"),
      date_from: z.string().optional().describe("ISO 8601 UTC date string — only return spans after this date"),
      date_to: z.string().optional().describe("ISO 8601 UTC date string — only return spans before this date"),
      limit: z.number().int().min(1).max(100).default(20).describe("Maximum number of spans to return"),
      offset: z.number().int().min(0).default(0).describe("Number of spans to skip for pagination"),
    },
    async ({ project_id, trace_id, type, model, provider, status, date_from, date_to, limit, offset }) => {
      const projectIds = project_id
        ? [project_id]
        : await getUserProjectIds(userId);

      if (!projectIds.length) {
        return { content: [{ type: "text", text: JSON.stringify([], null, 2) }] };
      }

      const { condition: projectCondition, params } = buildProjectCondition(projectIds, { limit, offset });
      const conditions: string[] = [projectCondition];

      if (trace_id) {
        conditions.push(`trace_id = {traceId: String}`);
        params["traceId"] = trace_id;
      }
      if (type) {
        conditions.push(`type = {spanType: String}`);
        params["spanType"] = type;
      }
      if (model) {
        conditions.push(`model = {model: String}`);
        params["model"] = model;
      }
      if (provider) {
        conditions.push(`provider = {provider: String}`);
        params["provider"] = provider;
      }
      if (status) {
        conditions.push(`status = {status: String}`);
        params["status"] = status;
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

      const result = await readonlyClickhouse.query({
        query: `
          SELECT
            id,
            trace_id,
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
            metadata
          FROM breadcrumb.spans
          WHERE ${where}
          ORDER BY start_time DESC
          LIMIT {limit: UInt32}
          OFFSET {offset: UInt32}
        `,
        query_params: params,
        format: "JSONEachRow",
      });

      const rows = (await result.json()) as Array<Record<string, unknown>>;
      const spans = rows.map((r) => {
        const spanStart = toUtc(String(r["start_time"]))!;
        const spanEnd = toUtc(String(r["end_time"]))!;
        return {
          id: String(r["id"]),
          traceId: String(r["trace_id"]),
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
          metadata: normMetadata(r["metadata"]),
        };
      });

      return {
        content: [{ type: "text", text: JSON.stringify(spans, null, 2) }],
      };
    }
  );
}
