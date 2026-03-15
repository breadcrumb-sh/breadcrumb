import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerProjectsTools } from "./tools/projects.js";
import { registerTracesTools } from "./tools/traces.js";
import { registerSpansTools } from "./tools/spans.js";
import { registerQueryTools } from "./tools/query.js";

export function buildMcpServer(userId: string): McpServer {
  const server = new McpServer({
    name: "breadcrumb",
    version: "1.0.0",
  });

  registerProjectsTools(server, userId);
  registerTracesTools(server, userId);
  registerSpansTools(server, userId);
  registerQueryTools(server, userId);

  return server;
}
