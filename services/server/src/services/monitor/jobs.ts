/**
 * pgBoss job handlers for the monitor agent.
 */

import { boss } from "../../shared/lib/boss.js";
import { eq } from "drizzle-orm";
import { db } from "../../shared/db/postgres.js";
import { monitorItems } from "../../shared/db/schema.js";
import { createLogger } from "../../shared/lib/logger.js";
import { runInvestigation } from "./agent.js";
import { runScan } from "./scan.js";
import { checkBudget, getScanInterval } from "./usage.js";
import { emitMonitorEvent } from "./events.js";
import { recordActivity } from "./activity.js";

const log = createLogger("monitor-jobs");

const PROCESS_JOB = "monitor-process";
const SCAN_JOB = "monitor-scan";
const PROCESS_DEBOUNCE_SECONDS = 60;
const DEFAULT_SCAN_INTERVAL = 300; // 5 min fallback

interface MonitorJobData {
  projectId: string;
  itemId: string;
}

interface ScanJobData {
  projectId: string;
}

export async function enqueueProcess(projectId: string, itemId: string, debounce = false) {
  if (debounce) {
    const jobId = await boss.send(PROCESS_JOB, { projectId, itemId }, {
      singletonKey: itemId,
      singletonSeconds: PROCESS_DEBOUNCE_SECONDS,
    });
    log.info({ projectId, itemId, jobId }, jobId ? "enqueued monitor-process" : "monitor-process deduplicated");
  } else {
    await boss.insert([{ name: PROCESS_JOB, data: { projectId, itemId } }]);
    log.info({ projectId, itemId }, "enqueued monitor-process (insert)");
  }
}

/** @internal Exported for testing */
export async function handleProcess(job: { data: MonitorJobData }) {
  const { projectId, itemId } = job.data;

  // Check if item is still actionable
  const [item] = await db
    .select({ status: monitorItems.status })
    .from(monitorItems)
    .where(eq(monitorItems.id, itemId));

  if (!item || item.status === "done") {
    log.info({ projectId, itemId, status: item?.status }, "skipping — item no longer actionable");
    return;
  }

  if (!(await checkBudget(projectId))) {
    log.info({ projectId, itemId }, "skipping — daily token limit reached");
    return;
  }

  log.info({ projectId, itemId }, "processing monitor item");

  const oldStatus = item.status;
  await db
    .update(monitorItems)
    .set({ status: "investigating", processing: true, updatedAt: new Date() })
    .where(eq(monitorItems.id, itemId));
  if (oldStatus !== "investigating") {
    await recordActivity(itemId, "status_change", "agent", { fromStatus: oldStatus, toStatus: "investigating" });
  }
  await recordActivity(itemId, "processing_started", "agent");
  emitMonitorEvent({ projectId, itemId, type: "processing" });

  try {
    await runInvestigation({ projectId, itemId });
  } finally {
    await db
      .update(monitorItems)
      .set({ processing: false, updatedAt: new Date() })
      .where(eq(monitorItems.id, itemId));
    await recordActivity(itemId, "processing_finished", "agent");
    emitMonitorEvent({ projectId, itemId, type: "processing" });
  }
}

export async function enqueueScan(projectId: string) {
  const interval = await getScanInterval(projectId);
  const jobId = await boss.send(SCAN_JOB, { projectId }, {
    singletonKey: projectId,
    singletonSeconds: interval,
  });
  if (jobId) log.info({ projectId, jobId, intervalSeconds: interval }, "enqueued monitor-scan");
}

/** @internal Exported for testing */
export async function handleScan(job: { data: ScanJobData }) {
  const { projectId } = job.data;

  if (!(await checkBudget(projectId))) {
    log.info({ projectId }, "skipping scan — daily token limit reached");
    return;
  }

  log.info({ projectId }, "running scan");
  await runScan(projectId);
}

export async function registerMonitorJobs() {
  await boss.createQueue(PROCESS_JOB).catch(() => {});
  await boss.createQueue(SCAN_JOB).catch(() => {});

  await boss.work<MonitorJobData>(PROCESS_JOB, { batchSize: 1 }, async ([job]) => {
    try {
      await handleProcess(job);
    } catch (err) {
      log.error({ err, ...job.data }, "monitor process failed");
      throw err;
    }
  });

  await boss.work<ScanJobData>(SCAN_JOB, { batchSize: 1 }, async ([job]) => {
    try {
      await handleScan(job);
    } catch (err) {
      log.error({ err, projectId: job.data.projectId }, "monitor scan failed");
      throw err;
    }
  });

  log.info("monitor jobs registered");
}
