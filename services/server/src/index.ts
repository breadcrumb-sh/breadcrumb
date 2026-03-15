import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { boss } from "./shared/lib/boss.js";
import { runMigrations } from "./shared/db/postgres.js";
import { runClickhouseMigrations, clickhouse, readonlyClickhouse, sandboxedClickhouse } from "./shared/db/clickhouse.js";
import { traceBatcher, spanBatcher } from "./api/ingest/routes.js";
import { env } from "./env.js";

// ── Startup ─────────────────────────────────────────────────────────────────
async function main() {
  await runMigrations();
  await runClickhouseMigrations();

  await boss.start();
  const { registerWorkers } = await import("./services/observations/evaluate-job.js");
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

// ── Graceful shutdown ───────────────────────────────────────────────────────
async function shutdown() {
  console.log("shutting down — flushing batchers…");
  await Promise.all([traceBatcher.shutdown(), spanBatcher.shutdown()]);
  await boss.stop();
  await Promise.all([
    clickhouse.close(),
    readonlyClickhouse.close(),
    sandboxedClickhouse.close(),
  ]);
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
