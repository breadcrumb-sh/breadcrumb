import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { clickhouse } from "../db/clickhouse.js";
import { db } from "../db/index.js";
import { member, organization, user as userTable } from "../db/schema.js";

import { calcDuration, normMetadata } from "./helpers.js";

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

  // ── get_stats ─────────────────────────────────────────────────────
  server.tool(
    "get_stats",
    "Get aggregated statistics: total trace count, total cost, and average trace duration. Aggregates across all accessible projects when no project_id is given.",
    {
      project_id: z.string().optional().describe("Limit stats to a specific project ID (optional)"),
    },
    async ({ project_id }) => {
      const projectIds = project_id
        ? [project_id]
        : await getUserProjectIds(userId);

      if (!projectIds.length) {
        return {
          content: [{ type: "text", text: JSON.stringify({ traceCount: 0, totalCostUsd: 0, avgDurationMs: 0 }, null, 2) }],
        };
      }

      const { condition, params } = buildProjectCondition(projectIds, {});

      const result = await clickhouse.query({
        query: `
          SELECT
            count()                AS trace_count,
            sum(r.total_cost_usd)  AS total_cost_usd,
            avgIf(
              toInt64(toUnixTimestamp64Milli(${EFFECTIVE_END})) - toInt64(toUnixTimestamp64Milli(t.start_time)),
              isNotNull(${EFFECTIVE_END}) AND ${EFFECTIVE_END} > t.start_time
            )                      AS avg_duration_ms
          FROM (
            SELECT
              id,
              argMax(start_time, version) AS start_time,
              argMax(end_time, version)   AS end_time
            FROM breadcrumb.traces
            WHERE ${condition}
            GROUP BY id
          ) t
          LEFT JOIN (
            SELECT
              trace_id,
              sum(input_cost_usd + output_cost_usd) AS total_cost_usd,
              max(max_end_time)                      AS max_end_time
            FROM breadcrumb.trace_rollups
            WHERE ${condition}
            GROUP BY trace_id
          ) r ON t.id = r.trace_id
        `,
        query_params: params,
        format: "JSONEachRow",
      });

      const rows = (await result.json()) as Array<Record<string, unknown>>;
      const row = rows[0] ?? {};

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            traceCount: Number(row["trace_count"] ?? 0),
            totalCostUsd: Number(row["total_cost_usd"] ?? 0) / 1_000_000,
            avgDurationMs: Number(row["avg_duration_ms"] ?? 0),
          }, null, 2),
        }],
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
      status: z.enum(["ok", "error"]).optional().describe("Filter by trace status"),
      environment: z.string().optional().describe("Filter by environment (e.g. 'production', 'development')"),
      user_id: z.string().optional().describe("Filter by user ID"),
      date_from: z.string().optional().describe("ISO date string — only return traces after this date"),
      date_to: z.string().optional().describe("ISO date string — only return traces before this date"),
    },
    async ({ project_id, limit, status, environment, user_id, date_from, date_to }) => {
      const projectIds = project_id
        ? [project_id]
        : await getUserProjectIds(userId);

      if (!projectIds.length) {
        return { content: [{ type: "text", text: JSON.stringify([], null, 2) }] };
      }

      const baseParams: Record<string, unknown> = { limit };
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

      const result = await clickhouse.query({
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
          ORDER BY t.start_time DESC
          LIMIT {limit: UInt32}
        `,
        query_params: params,
        format: "JSONEachRow",
      });

      const rows = (await result.json()) as Array<Record<string, unknown>>;
      const traces = rows.map((r) => {
        const startTime = String(r["start_time"]);
        const endTime = r["end_time"] != null ? String(r["end_time"]) : null;
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
        clickhouse.query({
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
        clickhouse.query({
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
      const trStartTime = String(tr["start_time"]);
      const trEndTime = tr["end_time"] != null ? String(tr["end_time"]) : null;

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
          const spanStart = String(r["start_time"]);
          const spanEnd = String(r["end_time"]);
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
            input: String(r["input"] ?? "") || null,
            output: String(r["output"] ?? "") || null,
            metadata: normMetadata(r["metadata"]),
          };
        }),
      };

      return {
        content: [{ type: "text", text: JSON.stringify(trace, null, 2) }],
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

      const result = await clickhouse.query({
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
        const startTime = String(r["start_time"]);
        const endTime = r["end_time"] != null ? String(r["end_time"]) : null;
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

  // ── search_traces ────────────────────────────────────────────────
  server.tool(
    "search_traces",
    "Search traces by name (case-insensitive substring match). Searches across all accessible projects when no project_id is given.",
    {
      query: z.string().min(1).describe("Search string to match against trace names"),
      limit: z.number().int().min(1).max(100).default(20).describe("Maximum number of results"),
      project_id: z.string().optional().describe("Limit to a specific project ID (optional)"),
    },
    async ({ query, limit, project_id }) => {
      const projectIds = project_id
        ? [project_id]
        : await getUserProjectIds(userId);

      if (!projectIds.length) {
        return { content: [{ type: "text", text: JSON.stringify([], null, 2) }] };
      }

      const { condition: projectCondition, params } = buildProjectCondition(projectIds, {
        pattern: `%${query.toLowerCase()}%`,
        limit,
      });

      const result = await clickhouse.query({
        query: `
          SELECT
            t.id,
            t.name,
            t.status,
            t.start_time,
            ${EFFECTIVE_END} AS end_time,
            t.user_id,
            t.environment
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
          WHERE lower(t.name) LIKE {pattern: String}
          ORDER BY t.start_time DESC
          LIMIT {limit: UInt32}
        `,
        query_params: params,
        format: "JSONEachRow",
      });

      const rows = (await result.json()) as Array<Record<string, unknown>>;
      const traces = rows.map((r) => {
        const startTime = String(r["start_time"]);
        const endTime = r["end_time"] != null ? String(r["end_time"]) : null;
        return {
          id: String(r["id"]),
          name: String(r["name"]),
          status: String(r["status"]),
          startTime,
          endTime,
          durationMs: calcDuration(startTime, endTime),
          userId: String(r["user_id"] ?? "") || null,
          environment: String(r["environment"] ?? "") || null,
        };
      });

      return {
        content: [{ type: "text", text: JSON.stringify(traces, null, 2) }],
      };
    }
  );

  return server;
}
