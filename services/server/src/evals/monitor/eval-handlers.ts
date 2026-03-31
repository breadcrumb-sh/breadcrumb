/**
 * Eval tool handler factories — fixture-backed implementations that record all operations.
 *
 * These implement the same handler interfaces as the production handlers,
 * but return fixture data and capture operations into MonitorEvalOutcome.
 */

import { formatQueryResult } from "../../services/monitor/format-query-result.js";
import type { ScanToolHandlers } from "../../services/monitor/scan-agent.js";
import type { InvestigateToolHandlers } from "../../services/monitor/investigate-agent.js";
import type { ScanFixture, InvestigateFixture, MonitorEvalOutcome } from "./types.js";
import { emptyOutcome } from "./types.js";

/**
 * Match a SQL query against fixture query responses.
 * Keys in queryResponses are substrings — first match wins.
 * Returns formatted string identical to the production handler.
 */
function matchQuery(sql: string, responses: Record<string, unknown[]>): string {
  for (const [pattern, rows] of Object.entries(responses)) {
    if (sql.includes(pattern)) {
      return formatQueryResult(rows);
    }
  }
  return formatQueryResult([]);
}

export function createEvalScanHandlers(fixture: ScanFixture): {
  handlers: ScanToolHandlers;
  outcome: MonitorEvalOutcome;
} {
  const outcome = emptyOutcome();
  let memory = fixture.projectMemory;

  const handlers: ScanToolHandlers = {
    async runQuery(sql) {
      outcome.queriesRun.push(sql);
      return matchQuery(sql, fixture.queryResponses);
    },

    async writeMemory(content) {
      outcome.memoryWrites.push(content);
      memory = content;
      return "Memory updated.";
    },

    async updateMemory(oldStr, newStr) {
      if (!memory.includes(oldStr)) {
        return "Error: old_string not found in memory.";
      }
      outcome.memoryUpdates.push({ oldStr, newStr });
      memory = memory.replace(oldStr, newStr);
      return "Memory updated.";
    },

    async createTicket(title, description, _delayMinutes) {
      outcome.ticketsCreated.push({ title, description });
      return `Ticket "${title}" created and scheduled for investigation.`;
    },
  };

  return { handlers, outcome };
}

export function createEvalInvestigateHandlers(fixture: InvestigateFixture): {
  handlers: InvestigateToolHandlers;
  outcome: MonitorEvalOutcome;
} {
  const outcome = emptyOutcome();
  let memory = fixture.projectMemory;
  let note = fixture.item.note;

  const handlers: InvestigateToolHandlers = {
    async runQuery(sql) {
      outcome.queriesRun.push(sql);
      return matchQuery(sql, fixture.queryResponses);
    },

    async writeFile(target, content) {
      if (target === "note") {
        outcome.noteWrites.push(content);
        note = content;
      } else {
        outcome.memoryWrites.push(content);
        memory = content;
      }
      return `${target} updated.`;
    },

    async updateFile(target, oldStr, newStr) {
      const current = target === "note" ? note : memory;
      if (!current.includes(oldStr)) {
        return `Error: old_string not found in ${target}.`;
      }
      if (target === "note") {
        outcome.noteUpdates.push({ oldStr, newStr });
        note = current.replace(oldStr, newStr);
      } else {
        outcome.memoryUpdates.push({ oldStr, newStr });
        memory = current.replace(oldStr, newStr);
      }
      return `${target} updated.`;
    },

    async addComment(content) {
      outcome.commentsAdded.push(content);
      return "Comment added.";
    },

    async setStatus(status) {
      outcome.statusSet = status;
      return `Status updated to "${status}".`;
    },

    async setProperties({ priority, labelNames, traceNames }) {
      const results: string[] = [];
      if (priority) {
        outcome.prioritySet = priority;
        results.push(`Priority set to "${priority}".`);
      }
      if (traceNames && traceNames.length > 0) {
        outcome.traceNamesSet = traceNames;
        results.push(`Linked to traces: ${traceNames.join(", ")}.`);
      }
      if (labelNames && labelNames.length > 0) {
        const available = fixture.availableLabels;
        const matched = labelNames.filter((n) => available.includes(n));
        const missing = labelNames.filter((n) => !available.includes(n));
        outcome.labelsSet = matched;
        if (matched.length > 0) results.push(`Labels set: ${matched.join(", ")}.`);
        if (missing.length > 0) results.push(`Labels not found: ${missing.join(", ")}.`);
      }
      return results.join(" ") || "No changes made.";
    },

    async scheduleFollowup({ delayMinutes, reason, newTicket }) {
      outcome.followupsScheduled.push({ delayMinutes, reason });
      if (newTicket) {
        outcome.ticketsCreated.push({ title: newTicket.title, description: newTicket.description });
        return `New ticket "${newTicket.title}" created and scheduled for investigation in ${delayMinutes} minutes.`;
      }
      return `Follow-up on this ticket scheduled in ${delayMinutes} minutes.`;
    },
  };

  return { handlers, outcome };
}
