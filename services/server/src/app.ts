import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { trimTrailingSlash } from "hono/trailing-slash";
import { rateLimiter } from "hono-rate-limiter";
import { readFile } from "node:fs/promises";
import { auth } from "./shared/auth/better-auth.js";
import { requireApiKey } from "./shared/auth/api-key.js";
import { requireMcpKey } from "./shared/auth/mcp-key.js";
import { trpcHandler } from "./api/trpc/handler.js";
import { ingestRoutes } from "./api/ingest/routes.js";
import { env } from "./env.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { buildMcpServer } from "./api/mcp/server.js";

export type AppVariables = {
  user: { id: string; email: string; name: string } | null;
  session: { id: string; userId: string } | null;
  projectId: string;
  userId: string;
};

export const app = new Hono<{ Variables: AppVariables }>();

// ── Trailing slash normalization ────────────────────────────────────────────
app.use(trimTrailingSlash());

// ── Security headers ────────────────────────────────────────────────────────
app.use(
  "*",
  secureHeaders({
    // Disable HSTS in development (HTTP, not HTTPS)
    strictTransportSecurity: env.nodeEnv === "production"
      ? "max-age=15552000; includeSubDomains"
      : false,
    // Allow cross-origin requests in development (Vite proxy)
    crossOriginResourcePolicy:
      env.nodeEnv === "production" ? "same-origin" : false,
    crossOriginOpenerPolicy:
      env.nodeEnv === "production" ? "same-origin" : false,
  }),
);

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

// ── Rate limiting ───────────────────────────────────────────────────────────
// Better Auth handles /api/auth/* rate limiting internally (configured in better-auth.ts).
// These cover the remaining endpoints.

// Ingest: per API key, 1000 req / 10s
app.use(
  "/v1/*",
  rateLimiter({
    windowMs: 10_000,
    limit: 1000,
    keyGenerator: (c) => c.req.header("Authorization") ?? "anonymous",
    standardHeaders: "draft-7",
  }),
);

// tRPC: per IP, 200 req / 60s
app.use(
  "/trpc/*",
  rateLimiter({
    windowMs: 60_000,
    limit: 200,
    keyGenerator: (c) =>
      c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip") ?? "anonymous",
    standardHeaders: "draft-7",
  }),
);

// MCP: per MCP key, 100 req / 60s
app.use(
  "/mcp",
  rateLimiter({
    windowMs: 60_000,
    limit: 100,
    keyGenerator: (c) => c.req.header("Authorization") ?? "anonymous",
    standardHeaders: "draft-7",
  }),
);

// ── Health ──────────────────────────────────────────────────────────────────
app.get("/health", (c) => c.json({ status: "ok" }));

// ── Auth routes ─────────────────────────────────────────────────────────────
app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

// ── Session middleware ──────────────────────────────────────────────────────
// Only runs for /trpc/* — ingest (/v1/*) and MCP (/mcp) use their own auth.
app.use("/trpc/*", async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  c.set("user", session?.user ?? null);
  c.set("session", session?.session ?? null);
  await next();
});

// ── Ingest routes (/v1/*) ───────────────────────────────────────────────────
app.use("/v1/*", requireApiKey);
app.route("/v1", ingestRoutes);

// ── tRPC ────────────────────────────────────────────────────────────────────
app.use("/trpc/*", trpcHandler);

// ── MCP ─────────────────────────────────────────────────────────────────────
app.all("/mcp", requireMcpKey, async (c) => {
  const userId = c.get("userId");
  const mcpServer = buildMcpServer(userId);
  const transport = new StreamableHTTPTransport();
  await mcpServer.connect(transport);
  return transport.handleRequest(c);
});

// ── Telemetry proxy ─────────────────────────────────────────────────
// Proxies frontend telemetry through our own domain so ad blockers
// don't recognise the requests. Uses a non-obvious path prefix — common
// names like /ingest, /analytics, /telemetry are on filter lists.
const PH_API = "https://eu.i.posthog.com";
const PH_ASSETS = "https://eu-assets.i.posthog.com";

app.all("/ext/static/*", async (c) => {
  const url = new URL(c.req.url);
  const target = `${PH_ASSETS}${url.pathname.replace("/ext/static", "/static")}${url.search}`;
  const resp = await fetch(target, {
    method: c.req.method,
    body: c.req.method === "GET" ? undefined : await c.req.arrayBuffer(),
  });
  return new Response(resp.body, {
    status: resp.status,
    headers: {
      "Content-Type": resp.headers.get("content-type") ?? "application/javascript",
      "Cache-Control": resp.headers.get("cache-control") ?? "public, max-age=86400",
    },
  });
});

app.all("/ext/*", async (c) => {
  const url = new URL(c.req.url);
  const target = `${PH_API}${url.pathname.replace("/ext", "")}${url.search}`;
  const resp = await fetch(target, {
    method: c.req.method,
    headers: { "Content-Type": c.req.header("content-type") ?? "application/json" },
    body: c.req.method === "GET" ? undefined : await c.req.arrayBuffer(),
  });
  return new Response(resp.body, {
    status: resp.status,
    headers: { "Content-Type": resp.headers.get("content-type") ?? "application/json" },
  });
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
