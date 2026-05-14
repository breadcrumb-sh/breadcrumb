/**
 * Eval tool handler factories — fixture-backed implementations that record all operations.
 *
 * These implement the same handler interfaces as the production handlers,
 * but return fixture data and capture operations into MonitorEvalOutcome.
 */

import { generateObject } from "ai";
import { z } from "zod";
import { formatQueryResult } from "../../services/monitor/format-query-result.js";
import { evalModel } from "./model.js";
import type { ScanToolHandlers } from "../../services/monitor/scan-agent.js";
import type { InvestigateToolHandlers } from "../../services/monitor/investigate-agent.js";
import type { ScanFixture, InvestigateFixture, MonitorEvalOutcome } from "./types.js";
import { emptyOutcome } from "./types.js";

/**
 * Match a SQL query against fixture query responses using an LLM judge.
 * The judge picks the best-matching response key for the given SQL, or "none".
 */
async function matchQuery(sql: string, responses: Record<string, unknown[]>): Promise<string> {
  const keys = Object.keys(responses);
  if (keys.length === 0) return formatQueryResult([]);

  const previews = keys.map((k) => {
    const rows = responses[k];
    const sample = JSON.stringify(rows[0] ?? {}).slice(0, 200);
    return `- "${k}": ${rows.length} rows, sample: ${sample}`;
  }).join("\n");

  const { object } = await generateObject({
    model: evalModel,
    temperature: 0,
    schema: z.object({
      key: z.string().describe("The best matching response key, or 'none' if no response fits"),
    }),
    prompt: `Given this SQL query and the available fixture responses, which response best matches what the query is asking for? Pick the key whose data the query would logically return. If none fit, return "none".

SQL:
${sql}

Available responses:
${previews}`,
  });

  if (object.key === "none" || !responses[object.key]) {
    return formatQueryResult([]);
  }
  return formatQueryResult(responses[object.key]);
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
