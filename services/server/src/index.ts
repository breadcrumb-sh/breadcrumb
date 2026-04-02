import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { boss } from "./shared/lib/boss.js";
import { runMigrations } from "./shared/db/postgres.js";
import { runClickhouseMigrations, clickhouse, readonlyClickhouse, sandboxedClickhouse } from "./shared/db/clickhouse.js";
import { traceBatcher, spanBatcher } from "./api/ingest/routes.js";
import { env } from "./env.js";
import { createLogger } from "./shared/lib/logger.js";
import { initTelemetry, shutdownTelemetry, trackServerStarted } from "./shared/lib/telemetry.js";

const log = createLogger("server");

// ── Startup ─────────────────────────────────────────────────────────────────
async function main() {
  await runMigrations();
  await runClickhouseMigrations();

  await boss.start();

  const { registerMonitorJobs } = await import("./services/monitor/jobs.js");
  await registerMonitorJobs();

  const { registerWebhookJobs } = await import("./services/monitor/webhooks.js");
  await registerWebhookJobs();

  const { startCronJobs } = await import("./cron.js");
  startCronJobs();

  const { initBreadcrumb } = await import("./shared/lib/breadcrumb.js");
  await initBreadcrumb();

  await initTelemetry();
  void trackServerStarted();

  serve({ fetch: app.fetch, port: env.port });
  log.info({ port: env.port }, "server listening");
}

main().catch((err) => {
  log.error({ err }, "fatal startup error");
  process.exit(1);
});

// ── Graceful shutdown ───────────────────────────────────────────────────────
async function shutdown() {
  log.info("shutting down — flushing batchers");
  await Promise.all([traceBatcher.shutdown(), spanBatcher.shutdown()]);
  await boss.stop();
  await shutdownTelemetry();
  await Promise.all([
    clickhouse.close(),
    readonlyClickhouse.close(),
    sandboxedClickhouse.close(),
  ]);
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
