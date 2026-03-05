import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { readFile } from "node:fs/promises";
import { auth } from "./auth/better-auth.js";
import { requireApiKey, requireMcpKey } from "./auth/index.js";
import { trpcHandler } from "./trpc/index.js";
import { ingestRoutes, traceBatcher, spanBatcher } from "./ingest/index.js";
import { boss } from "./lib/boss.js";
import { runMigrations } from "./db/index.js";
import { runClickhouseMigrations } from "./db/clickhouse.js";
import { env } from "./env.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { buildMcpServer } from "./mcp/index.js";

const app = new Hono();

const corsConfig = cors({
  origin: env.appBaseUrl,
  credentials: true,
  allowHeaders: ["Content-Type", "Authorization"],
  allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
});

app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

// CORS for the rest of the API
app.use("/trpc/*", corsConfig);
app.use("/v1/*", corsConfig);
app.use("/api/*", corsConfig);
app.use("/mcp", corsConfig);
app.use("/health", corsConfig);

app.get("/health", (c) => c.json({ status: "ok" }));

// Session middleware — populates user/session on the Hono context for tRPC.
app.use("*", async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (c as any).set("user", session?.user ?? null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (c as any).set("session", session?.session ?? null);
  await next();
});

app.use("/v1/*", requireApiKey);
app.route("/v1", ingestRoutes);

app.use("/trpc/*", trpcHandler);

app.all("/mcp", requireMcpKey, async (c) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userId = (c as any).get("userId") as string;
  const mcpServer = buildMcpServer(userId);
  const transport = new StreamableHTTPTransport();
  await mcpServer.connect(transport);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return transport.handleRequest(c as any);
});

if (env.nodeEnv === "production") {
  app.use("/*", serveStatic({ root: "./public" }));
  app.get("*", async (c) => {
    const html = await readFile("./public/index.html", "utf-8");
    return c.html(html);
  });
}

async function main() {
  await runMigrations();
  await runClickhouseMigrations();

  await boss.start();
  const { registerWorkers } = await import("./jobs/evaluate-observation.js");
  await registerWorkers();

  const { startCronJobs } = await import("./cron.js");
  startCronJobs();

  serve({ fetch: app.fetch, port: env.port });
  console.log(`server listening on port ${env.port}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

async function shutdown() {
  console.log("shutting down — flushing batchers…");
  await Promise.all([traceBatcher.shutdown(), spanBatcher.shutdown()]);
  await boss.stop();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
