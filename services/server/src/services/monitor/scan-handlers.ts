/**
 * Production tool handlers for the scan agent.
 */

import { eq } from "drizzle-orm";
import { boss } from "../../shared/lib/boss.js";
import { runSandboxedQuery } from "../../shared/lib/sandboxed-query.js";
import { db } from "../../shared/db/postgres.js";
import { monitorItems, project } from "../../shared/db/schema.js";
import { createLogger } from "../../shared/lib/logger.js";
import { formatQueryResult } from "./format-query-result.js";
import type { ScanToolHandlers } from "./scan-agent.js";

const log = createLogger("monitor-scan");

export function createProductionScanHandlers(
  projectId: string,
  state: { memory: string },
): ScanToolHandlers {
  return {
    async runQuery(sql) {
      log.debug({ projectId, sql }, "scan query");
      try {
        const rows = await runSandboxedQuery(projectId, sql, "monitor-scan");
        return formatQueryResult(rows);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Query failed";
        log.warn({ projectId, sql, err: msg }, "scan query failed");
        return `Error: ${msg}`;
      }
    },

    async writeMemory(content) {
      await db.update(project).set({ agentMemory: content }).where(eq(project.id, projectId));
      state.memory = content;
      log.debug({ projectId }, "scan updated memory");
      return "Memory updated.";
    },

    async updateMemory(oldStr, newStr) {
      if (!state.memory.includes(oldStr)) {
        return "Error: old_string not found in memory.";
      }
      const updated = state.memory.replace(oldStr, newStr);
      await db.update(project).set({ agentMemory: updated }).where(eq(project.id, projectId));
      state.memory = updated;
      log.debug({ projectId }, "scan updated memory section");
      return "Memory updated.";
    },

    async createTicket(title, description, delayMinutes) {
      const [created] = await db
        .insert(monitorItems)
        .values({ projectId, title, description, source: "agent", read: false })
        .returning();
      log.info({ projectId, itemId: created.id, title }, "scan created ticket");

      const delay = delayMinutes ?? 0;
      if (delay > 0) {
        await boss.send("monitor-process", { projectId, itemId: created.id }, { startAfter: delay * 60 });
      } else {
        await boss.insert([{ name: "monitor-process", data: { projectId, itemId: created.id } }]);
      }
      return `Ticket "${title}" created and scheduled for investigation.`;
    },
  };
}
