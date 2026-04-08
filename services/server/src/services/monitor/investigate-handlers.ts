/**
 * Production tool handlers for the investigation agent.
 */

import type { LanguageModel } from "ai";
import { and, eq, inArray } from "drizzle-orm";
import { boss } from "../../shared/lib/boss.js";
import { runSandboxedQuery } from "../../shared/lib/sandboxed-query.js";
import { db } from "../../shared/db/postgres.js";
import { monitorItems, monitorComments, monitorLabels, monitorItemLabels, project } from "../../shared/db/schema.js";
import { createLogger } from "../../shared/lib/logger.js";
import { formatQueryResult } from "./format-query-result.js";
import { checkDuplicate } from "./dedup.js";
import { emitMonitorEvent } from "./events.js";
import { recordActivity } from "./activity.js";
import { enqueueWebhooks } from "./webhooks.js";
import { createRepoToolHandlers } from "../github/repo-tool-handlers.js";
import type { RepoToolHandlers } from "../github/repo-tools.js";
import type { InvestigateToolHandlers } from "./investigate-agent.js";

const log = createLogger("monitor-agent");

/**
 * Build repo tool handlers if the project has a usable GitHub installation.
 * Returns null on any failure (no installation, suspended, no tracked repos,
 * misconfigured app) — the caller treats null as "no code access" and the
 * tools are simply not exposed to the agent.
 */
export async function tryCreateRepoHandlers(
  projectId: string,
): Promise<RepoToolHandlers | null> {
  try {
    return await createRepoToolHandlers(projectId);
  } catch (err) {
    log.debug(
      { projectId, err: err instanceof Error ? err.message : String(err) },
      "no repo tools for this investigation",
    );
    return null;
  }
}

export function createProductionInvestigateHandlers(
  projectId: string,
  itemId: string,
  state: { memory: string; note: string; status: string },
  model: LanguageModel,
  repo: RepoToolHandlers | null = null,
): InvestigateToolHandlers {
  return {
    repo,
    async runQuery(sql) {
      log.debug({ projectId, sql }, "running query");
      try {
        const rows = await runSandboxedQuery(projectId, sql, "monitor");
        return formatQueryResult(rows);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Query failed";
        log.warn({ projectId, sql, err: msg }, "query failed");
        return `Error: ${msg}`;
      }
    },

    async writeFile(target, content) {
      if (target === "note") {
        await db.update(monitorItems).set({ note: content, updatedAt: new Date() }).where(eq(monitorItems.id, itemId));
        state.note = content;
        emitMonitorEvent({ projectId, itemId, type: "status" });
      } else {
        await db.update(project).set({ agentMemory: content }).where(eq(project.id, projectId));
        state.memory = content;
      }
      log.debug({ itemId, target }, "write_file");
      return `${target} updated.`;
    },

    async updateFile(target, oldStr, newStr) {
      const current = target === "note" ? state.note : state.memory;
      if (!current.includes(oldStr)) {
        return `Error: old_string not found in ${target}.`;
      }
      const updated = current.replace(oldStr, newStr);
      if (target === "note") {
        await db.update(monitorItems).set({ note: updated, updatedAt: new Date() }).where(eq(monitorItems.id, itemId));
        state.note = updated;
        emitMonitorEvent({ projectId, itemId, type: "status" });
      } else {
        await db.update(project).set({ agentMemory: updated }).where(eq(project.id, projectId));
        state.memory = updated;
      }
      log.debug({ itemId, target }, "update_file");
      return `${target} updated.`;
    },

    async addComment(content) {
      log.debug({ itemId }, "adding comment");
      await db.insert(monitorComments).values({
        monitorItemId: itemId,
        source: "agent",
        content,
      });
      await db
        .update(monitorItems)
        .set({ read: false, updatedAt: new Date() })
        .where(eq(monitorItems.id, itemId));
      emitMonitorEvent({ projectId, itemId, type: "comment" });
      return "Comment added.";
    },

    async setStatus(status) {
      log.info({ itemId, status }, "agent updating status");
      const oldStatus = state.status;
      await db
        .update(monitorItems)
        .set({ status, read: status === "done", updatedAt: new Date() })
        .where(eq(monitorItems.id, itemId));
      if (status !== oldStatus) {
        await recordActivity(itemId, "status_change", "agent", { fromStatus: oldStatus, toStatus: status });
      }
      state.status = status;
      emitMonitorEvent({ projectId, itemId, type: "status" });
      if (status === "review") {
        await enqueueWebhooks(projectId, itemId);
      }
      return `Status updated to "${status}".`;
    },

    async setProperties({ priority, labelNames, traceNames }) {
      const results: string[] = [];

      if (priority) {
        await db.update(monitorItems).set({ priority, updatedAt: new Date() }).where(eq(monitorItems.id, itemId));
        results.push(`Priority set to "${priority}".`);
      }

      if (traceNames && traceNames.length > 0) {
        await db.update(monitorItems).set({ traceNames, updatedAt: new Date() }).where(eq(monitorItems.id, itemId));
        results.push(`Linked to traces: ${traceNames.join(", ")}.`);
      }

      if (labelNames && labelNames.length > 0) {
        const labels = await db
          .select({ id: monitorLabels.id, name: monitorLabels.name })
          .from(monitorLabels)
          .where(and(eq(monitorLabels.projectId, projectId), inArray(monitorLabels.name, labelNames)));

        if (labels.length > 0) {
          await db.delete(monitorItemLabels).where(eq(monitorItemLabels.monitorItemId, itemId));
          await db.insert(monitorItemLabels).values(
            labels.map((l) => ({ monitorItemId: itemId, monitorLabelId: l.id })),
          );
          results.push(`Labels set: ${labels.map((l) => l.name).join(", ")}.`);
          const missing = labelNames.filter((n) => !labels.some((l) => l.name === n));
          if (missing.length > 0) results.push(`Labels not found: ${missing.join(", ")}.`);
        } else {
          results.push(`No matching labels found for: ${labelNames.join(", ")}.`);
        }
      }

      emitMonitorEvent({ projectId, itemId, type: "status" });
      return results.join(" ") || "No changes made.";
    },

    async scheduleFollowup({ delayMinutes, reason, newTicket }) {
      if (newTicket) {
        const dedup = await checkDuplicate(projectId, newTicket.title, newTicket.description, model);
        if (dedup.blocked) {
          return dedup.message;
        }

        log.info({ itemId, delayMinutes, reason, newTitle: newTicket.title }, "creating new scheduled ticket");
        const [created] = await db
          .insert(monitorItems)
          .values({
            projectId,
            title: newTicket.title,
            description: newTicket.description,
            source: "agent",
            read: false,
          })
          .returning();
        await recordActivity(created.id, "created", "agent");
        await boss.send(
          "monitor-process",
          { projectId, itemId: created.id },
          { startAfter: delayMinutes * 60 },
        );
        return `New ticket "${newTicket.title}" created and scheduled for investigation in ${delayMinutes} minutes.`;
      }

      log.info({ itemId, delayMinutes, reason }, "scheduling follow-up");
      await boss.send(
        "monitor-process",
        { projectId, itemId },
        { startAfter: delayMinutes * 60 },
      );
      return `Follow-up on this ticket scheduled in ${delayMinutes} minutes.`;
    },
  };
}
