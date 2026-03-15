import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CLICKHOUSE_SCHEMA } from "../../../services/explore/clickhouse-schema.js";
import { runSandboxedQuery } from "../../../shared/lib/sandboxed-query.js";
import { getUserProjectIds, truncateResult } from "../helpers.js";

export function registerQueryTools(server: McpServer, userId: string) {
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
}
