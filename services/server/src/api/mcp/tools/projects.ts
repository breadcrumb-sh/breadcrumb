import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { eq } from "drizzle-orm";
import { db } from "../../../shared/db/postgres.js";
import { member, organization, project } from "../../../shared/db/schema.js";

export function registerProjectsTools(server: McpServer, userId: string) {
  server.tool(
    "list_projects",
    "List all projects the user has access to.",
    {},
    async () => {
      const rows = await db
        .select({
          id: project.id,
          name: project.name,
          organizationName: organization.name,
        })
        .from(member)
        .innerJoin(organization, eq(member.organizationId, organization.id))
        .innerJoin(project, eq(project.organizationId, organization.id))
        .where(eq(member.userId, userId));

      return {
        content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
      };
    }
  );
}
