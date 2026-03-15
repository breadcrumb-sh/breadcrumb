import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { readonlyClickhouse } from "../db/clickhouse.js";
import { db } from "../db/index.js";
import { member, organization, user as userTable } from "../db/schema.js";
import { CLICKHOUSE_SCHEMA } from "../lib/clickhouse-schema.js";
import { runSandboxedQuery } from "../lib/sandboxed-query.js";

import { calcDuration, normMetadata, toUtc, truncateSpanField } from "./helpers.js";

// COALESCE(trace.end_time, rollup.max_end_time):
// trace.end_time is Nullable — NULL when trace.end() was never called.
// max_end_time is the latest span.end_time from trace_rollups.
// Together they give a real duration for any trace that has at least one span.
const EFFECTIVE_END = `COALESCE(t.end_time, r.max_end_time)`;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getUserProjectIds(userId: string): Promise<string[]> {
  const [u] = await db
    .select({ role: userTable.role })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);

  // Admins can see all projects
  if (u?.role === "admin") {
    const orgs = await db.select({ id: organization.id }).from(organization);
    return orgs.map((o) => o.id);
  }

  const rows = await db
    .select({ orgId: member.organizationId })
    .from(member)
    .where(eq(member.userId, userId));
  return rows.map((r) => r.orgId);
}

/**
 * Build a ClickHouse WHERE condition and named params for a set of project IDs.
 * Returns { condition, params } where params are named p0, p1, ...
 */
function buildProjectCondition(
  projectIds: string[],
  existingParams: Record<string, unknown>
): { condition: string; params: Record<string, unknown> } {
  const params = { ...existingParams };
  if (projectIds.length === 1) {
    params["p0"] = projectIds[0];
    return { condition: `project_id = {p0: UUID}`, params };
  }
  const placeholders = projectIds.map((id, i) => {
    params[`p${i}`] = id;
    return `{p${i}: UUID}`;
  });
  return { condition: `project_id IN (${placeholders.join(", ")})`, params };
}

const ROLLUPS_JOIN = (condition: string) => `
  LEFT JOIN (
    SELECT
      trace_id,
      sum(input_tokens)    AS input_tokens,
      sum(output_tokens)   AS output_tokens,
      sum(input_cost_usd)  AS input_cost_usd,
      sum(output_cost_usd) AS output_cost_usd,
      sum(span_count)      AS span_count,
      max(max_end_time)    AS max_end_time
    FROM breadcrumb.trace_rollups
    WHERE ${condition}
    GROUP BY trace_id
  ) r ON t.id = r.trace_id
`;

const MAX_QUERY_ROWS = 100;
const MAX_RESULT_CHARS = 8000;

function truncateResult(rows: Record<string, unknown>[]): { data: string; note: string | null } {
  const capped = rows.slice(0, MAX_QUERY_ROWS);
  let json = JSON.stringify(capped, null, 2);
  const notes: string[] = [];

  if (rows.length > MAX_QUERY_ROWS) {
    notes.push(`showing first ${MAX_QUERY_ROWS} of ${rows.length} rows`);
  }
  if (json.length > MAX_RESULT_CHARS) {
    json = json.slice(0, MAX_RESULT_CHARS);
    // Walk back to the last complete line to avoid broken JSON in the display
    const lastNewline = json.lastIndexOf("\n");
    if (lastNewline > 0) json = json.slice(0, lastNewline);
    notes.push(`output truncated at ${MAX_RESULT_CHARS} chars`);
  }

  return { data: json, note: notes.length ? notes.join(", ") : null };
}

// ── Server factory ────────────────────────────────────────────────────────────

export function buildMcpServer(userId: string): McpServer {
  const server = new McpServer({
    name: "breadcrumb",
    version: "1.0.0",
  });

  // ── list_projects ─────────────────────────────────────────────────
  server.tool(
    "list_projects",
    "List all projects the user has access to.",
    {},
    async () => {
      const rows = await db
        .select({ id: organization.id, name: organization.name })
        .from(member)
        .innerJoin(organization, eq(member.organizationId, organization.id))
        .where(eq(member.userId, userId));

      return {
        content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
      };
    }
  );

  // ── list_traces ──────────────────────────────────────────────────
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

  // ── get_trace ────────────────────────────────────────────────────
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

  // ── get_span ─────────────────────────────────────────────────────
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

  // ── list_spans ────────────────────────────────────────────────────
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
          inputTokens: Number(r["input_tokens"] ?? 0),  // list_spans
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

  // ── find_outliers ────────────────────────────────────────────────
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

  // ── introspect_schema ─────────────────────────────────────────────
  server.tool(
    "introspect_schema",
    "Returns the ClickHouse database schema — table names, column names, and types. Use this before writing a run_query SQL to understand the available data.",
    {},
    async () => {
      return {
        content: [{ type: "text", text: CLICKHOUSE_SCHEMA }],
      };
    }
  );

  // ── run_query ────────────────────────────────────────────────────
  server.tool(
    "run_query",
    "Execute a read-only ClickHouse SELECT query against your trace data. Use introspect_schema first to understand the schema. Always filter by project using the {projectId: UUID} named parameter — it is automatically injected from the project_id you supply.",
    {
      sql: z.string().describe("A ClickHouse SELECT query. Use {projectId: UUID} to scope results to the project."),
      project_id: z.string().describe("The project ID to query. Results are scoped to this project via the {projectId: UUID} query parameter."),
    },
    async ({ sql, project_id }) => {
      // Verify the user has access to this project
      const projectIds = await getUserProjectIds(userId);
      if (!projectIds.includes(project_id)) {
        return {
          content: [{ type: "text", text: "Error: project not found or access denied." }],
        };
      }

      try {
        const rows = await runSandboxedQuery(project_id, sql);
        const { data, note } = truncateResult(rows);
        const parts = [`rowCount: ${rows.length}`, note ? `note: ${note}` : null, data]
          .filter(Boolean)
          .join("\n");
        return {
          content: [{ type: "text", text: parts }],
        };
      } catch (err) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              error: err instanceof Error ? err.message : "Query execution failed",
            }),
          }],
        };
      }
    }
  );

  return server;
}
