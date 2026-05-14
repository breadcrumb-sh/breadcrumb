import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerProjectsTools } from "./tools/projects.js";
import { registerTracesTools } from "./tools/traces.js";
import { registerSpansTools } from "./tools/spans.js";
import { registerQueryTools } from "./tools/query.js";
import { trackMcpToolUsed } from "../../shared/lib/telemetry.js";

/** Wraps server.tool so every call is tracked via telemetry. */
function withTracking(server: McpServer): McpServer {
  const original = server.tool.bind(server);
  server.tool = ((name: string, ...rest: unknown[]) => {
    // Find the callback (last argument) and wrap it
    const cb = rest[rest.length - 1];
    if (typeof cb === "function") {
      rest[rest.length - 1] = (...args: unknown[]) => {
        trackMcpToolUsed(name);
        return (cb as Function)(...args);
      };
    }
    return (original as Function)(name, ...rest);
  }) as typeof server.tool;
  return server;
}

export function buildMcpServer(userId: string): McpServer {
  const server = withTracking(
    new McpServer({
      name: "breadcrumb",
      version: "1.0.0",
    }),
  );

  registerProjectsTools(server, userId);
  registerTracesTools(server, userId);
  registerSpansTools(server, userId);
  registerQueryTools(server, userId);

  return server;
}
