import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { readFile } from "node:fs/promises";
import { auth } from "./shared/auth/better-auth.js";
import { requireApiKey } from "./shared/auth/api-key.js";
import { requireMcpKey } from "./shared/auth/mcp-key.js";
import { trpcHandler } from "./api/trpc/handler.js";
import { ingestRoutes } from "./api/ingest/routes.js";
import { env } from "./env.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { buildMcpServer } from "./api/mcp/server.js";

export const app = new Hono();

// ── Security headers ────────────────────────────────────────────────────────
app.use("*", secureHeaders());

// ── CORS (registered before all route handlers) ─────────────────────────────
const corsConfig = cors({
  origin: env.appBaseUrl,
  credentials: true,
  allowHeaders: ["Content-Type", "Authorization"],
  allowMethods: ["GET", "POST", "OPTIONS"],
});

app.use("/api/*", corsConfig);
app.use("/trpc/*", corsConfig);
app.use("/v1/*", corsConfig);
app.use("/mcp", corsConfig);
app.use("/health", corsConfig);

// ── Health ──────────────────────────────────────────────────────────────────
app.get("/health", (c) => c.json({ status: "ok" }));

// ── Auth routes ─────────────────────────────────────────────────────────────
app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

// ── Session middleware ──────────────────────────────────────────────────────
// Only runs for /trpc/* — ingest (/v1/*) and MCP (/mcp) use their own auth.
app.use("/trpc/*", async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (c as any).set("user", session?.user ?? null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (c as any).set("session", session?.session ?? null);
  await next();
});

// ── Ingest routes (/v1/*) ───────────────────────────────────────────────────
app.use("/v1/*", requireApiKey);
app.route("/v1", ingestRoutes);

// ── tRPC ────────────────────────────────────────────────────────────────────
app.use("/trpc/*", trpcHandler);

// ── MCP ─────────────────────────────────────────────────────────────────────
app.all("/mcp", requireMcpKey, async (c) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userId = (c as any).get("userId") as string;
  const mcpServer = buildMcpServer(userId);
  const transport = new StreamableHTTPTransport();
  await mcpServer.connect(transport);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return transport.handleRequest(c as any);
});

// ── SPA fallback (production) ───────────────────────────────────────────────
if (env.nodeEnv === "production") {
  app.use("/*", serveStatic({ root: "./public" }));

  // Cache index.html in memory — avoid reading from disk on every request
  let indexHtml: string | null = null;
  app.get("*", async (c) => {
    if (!indexHtml) indexHtml = await readFile("./public/index.html", "utf-8");
    return c.html(indexHtml);
  });
}
