import { z } from "zod";
import { router, projectViewerProcedure } from "../../../trpc.js";
import { readonlyClickhouse } from "../../../shared/db/clickhouse.js";
import { ROLLUPS_SUBQUERY } from "../../../services/traces/helpers.js";
import { SANDBOXED_QUERY_SETTINGS } from "../../../shared/lib/sandboxed-query.js";

export const listRouter = router({
  list: projectViewerProcedure
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
        sortBy:      z.enum(["name","status","spanCount","tokens","cost","duration","startTime"]).default("startTime"),
        sortDir:     z.enum(["asc","desc"]).default("desc"),
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

      if (input.query) {
        clauses.push(`t.id IN (
          SELECT DISTINCT trace_id FROM breadcrumb.spans
          WHERE project_id = {projectId: UUID}
            AND (input ilike {searchText: String} OR output ilike {searchText: String} OR name ilike {searchText: String})
        )`);
        params.searchText = `%${input.query}%`;
      }

      const whereStr = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

      const sortExprMap: Record<string, string> = {
        name:      "t.name",
        status:    "t.status",
        spanCount: "coalesce(r.span_count, 0)",
        tokens:    "coalesce(r.input_tokens, 0) + coalesce(r.output_tokens, 0)",
        cost:      "coalesce(r.input_cost_usd + r.output_cost_usd, 0)",
        duration:  "if(isNotNull(COALESCE(t.end_time, r.max_end_time)), toInt64(toUnixTimestamp64Milli(COALESCE(t.end_time, r.max_end_time))) - toInt64(toUnixTimestamp64Milli(t.start_time)), 0)",
        startTime: "t.start_time",
      };
      const sortExpr = sortExprMap[input.sortBy] ?? "t.start_time";
      const sortDirection = input.sortDir === "asc" ? "ASC" : "DESC";

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
        ORDER BY ${sortExpr} ${sortDirection}
        LIMIT {limit: UInt32} OFFSET {offset: UInt32}
      `;

      const result = await readonlyClickhouse.query({
        query: sql,
        query_params: params,
        format: "JSONEachRow",
        clickhouse_settings: SANDBOXED_QUERY_SETTINGS,
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
      };
    }),
});
