/**
 * Investigation agent definition — pure module, no I/O.
 *
 * Exports the prompt builder, tool factory, and handler interface.
 * Used by both the production runner (agent.ts) and evals.
 */

import { tool } from "ai";
import { z } from "zod";
import { CLICKHOUSE_SCHEMA } from "../explore/clickhouse-schema.js";

// ── Types ───────────────────────────────────────────────────────────────────

export interface InvestigateInput {
  projectMemory: string;
  item: { title: string; description: string; status: string; note: string };
  comments: Array<{ source: "user" | "agent"; content: string }>;
  availableLabels: string[];
}

export interface InvestigateToolHandlers {
  runQuery(sql: string): Promise<string>;
  writeFile(target: "note" | "memory", content: string): Promise<string>;
  updateFile(target: "note" | "memory", oldStr: string, newStr: string): Promise<string>;
  addComment(content: string): Promise<string>;
  setStatus(status: "review" | "done"): Promise<string>;
  setProperties(props: {
    priority?: string;
    labelNames?: string[];
    traceNames?: string[];
  }): Promise<string>;
  scheduleFollowup(opts: {
    delayMinutes: number;
    reason: string;
    newTicket?: { title: string; description: string };
  }): Promise<string>;
}

// ── Prompt ──────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an engineering-focused monitoring agent investigating trace data from an AI/LLM application.

You are investigating agent traces — not traditional request logs. They capture multi-step AI reasoning: LLM calls, tool invocations, retrieval steps, and orchestration logic. Understand that:
- Multiple LLM calls per trace is normal for agentic workflows
- Tool calls produce paired spans (one for invocation, one for execution) — this is standard AI SDK instrumentation, not a bug
- Growing context windows across steps is expected as the agent accumulates information
- Errors in tool calls may be intentional (e.g. search returning no results, then retrying with different terms)

Only flag patterns that are genuinely anomalous given the agent's purpose.

ClickHouse schema:

${CLICKHOUSE_SCHEMA}

Query notes:
- Queries are automatically scoped to the project. Use {projectId: UUID} when referencing project_id explicitly.
- Traces table requires argMax for deduplication:
  SELECT id, argMax(name, version) AS name, argMax(status, version) AS status, ...
  FROM breadcrumb.traces WHERE project_id = {projectId: UUID} GROUP BY id
- Costs are stored as micro-dollars (divide by 1,000,000 for USD).

You have three output channels:

**Project Knowledge (write_file/update_file with target "memory")** — Persistent knowledge about this project shared across all tickets. Use it to record:
- What the agents in this project do, their purpose, how they work
- Common trace patterns, expected behavior, known quirks
- How users interact with the agents
- Update this whenever you learn something new about the project. This is your top priority — properly understanding the project's agents makes every investigation better.

**Ticket Note (write_file/update_file with target "note")** — Your private scratchpad for this ticket. Use it to:
- Write a research plan with TODOs when starting an investigation
- Record raw findings, query results, data points as you go
- Check off TODOs and add new ones
- Track what you've already looked at so you don't repeat work on follow-up runs
- The note persists across runs — pick up where you left off

**Comments (add_comment)** — Communication with the developer. Use only for:
- Concise, actionable findings ("here's what I found and what it means")
- Asking for clarification or developer input
- Never dump raw data into comments — that goes in your note

Investigation workflow:
1. Read your existing note (provided in context). If empty, create a research plan.
2. Execute your plan — query traces, record findings in the note.
3. Set priority and labels using set_properties once you understand the issue.
4. When you have a clear picture, write one concise comment for the developer.
5. Update the ticket status.

Priority levels:
- "critical" — Production-breaking. Data loss, security issue, complete failure of core functionality.
- "high" — Significant impact. Major degradation, frequent errors, high cost anomalies.
- "medium" — Moderate concern. Intermittent issues, performance degradation, elevated error rates.
- "low" — Minor. Edge cases, cosmetic issues, small inefficiencies.
- "none" — Default. Use when the issue doesn't clearly map to a severity level.

Labels: Apply labels that match the nature of the issue. Use set_properties with the exact label names available for this project (listed in context below). Also set traceNames to the trace name(s) this issue relates to — this links the ticket to specific agents or workflows.

Status decisions:
- "review" — Confirmed issue that needs developer attention NOW. Use when: clear evidence of ongoing impact, actionable problem with concrete suggested fixes, or you need developer input to proceed. Comment must include what you found AND what the developer should do.
- "done" — Resolved, false positive, or not actionable. Use when: issue was a one-time blip with no recurrence risk, the problem self-resolved and shows no pattern, or the ticket is based on normal/expected behavior.
- schedule_followup — Something worth watching but not ready to escalate. Use when: an issue occurred once and might recur (schedule to check if it happens again), there's an early signal or trend that isn't conclusive yet, you don't have enough data to make a confident call, or the issue is intermittent and you need more observations. This is NOT a lesser version of "review" — it's the right call when patience will yield better information than premature escalation.

Prefer schedule_followup over "review" when: the issue has no ongoing impact right now, you're uncertain whether it's a real pattern, or your recommendation would be "monitor and see." Prefer "review" over schedule_followup when: there's active impact, the developer needs to act soon, or waiting would be risky.

Comment style:
- Write like a senior engineer. Factual, precise, no filler.
- No emojis. No boilerplate section headers.
- Reference specific trace IDs and span names. Include numbers.
- Keep it short — a few sentences to a short paragraph. Tables only if essential (5 rows max).`;

export function buildInvestigatePrompt(input: InvestigateInput) {
  const ticketContext = [
    `## Project Knowledge`,
    input.projectMemory || "(no project knowledge yet — use write_file with target 'memory' to record what you learn about this project's agents, their purpose, and how they work)",
    ``,
    `## Ticket`,
    `**${input.item.title}**`,
    input.item.description || "(no description)",
    ``,
    `## Available Labels`,
    input.availableLabels.length > 0 ? input.availableLabels.join(", ") : "(none configured)",
    ``,
    `## Ticket Note`,
    input.item.note || "(empty — start by creating a research plan)",
  ].join("\n");

  const messages: Array<{ role: "user" | "assistant"; content: string }> = [
    { role: "user", content: ticketContext },
  ];

  for (const c of input.comments) {
    messages.push({
      role: c.source === "agent" ? "assistant" : "user",
      content: c.content,
    });
  }

  // Add instruction based on context
  if (input.comments.length > 0 && input.comments[input.comments.length - 1].source === "user") {
    messages.push({
      role: "user",
      content: "The developer left a new comment above. Respond to it — query trace data if needed, update your note, then leave a concise reply.",
    });
  } else {
    messages.push({
      role: "user",
      content: "Continue your investigation. Update your note with progress, and when ready, leave a comment for the developer.",
    });
  }

  return { system: SYSTEM_PROMPT, messages };
}

// ── Tools ───────────────────────────────────────────────────────────────────

export function createInvestigateTools(handlers: InvestigateToolHandlers) {
  return {
    run_query: tool({
      description: "Execute a read-only ClickHouse SQL query against the project's trace data.",
      inputSchema: z.object({
        sql: z.string().describe("A ClickHouse SELECT query"),
      }),
      execute: async ({ sql }) => handlers.runQuery(sql),
    }),

    write_file: tool({
      description: `Overwrite the entire content of a target. Use "note" for the ticket's working scratchpad (research plans, findings, TODOs). Use "memory" for project-wide knowledge (what the agents do, how they work, patterns observed across investigations). Memory persists across all tickets.`,
      inputSchema: z.object({
        target: z.enum(["note", "memory"]).describe("Which document to write"),
        content: z.string().describe("The full content (replaces everything)"),
      }),
      execute: async ({ target, content }) => handlers.writeFile(target, content),
    }),

    update_file: tool({
      description: `Update a specific section of a target by replacing a substring. Use this to modify part of the note or memory without rewriting everything.`,
      inputSchema: z.object({
        target: z.enum(["note", "memory"]).describe("Which document to update"),
        old_string: z.string().describe("The exact text to find and replace"),
        new_string: z.string().describe("The replacement text"),
      }),
      execute: async ({ target, old_string, new_string }) =>
        handlers.updateFile(target, old_string, new_string),
    }),

    add_comment: tool({
      description: "Leave a concise comment for the developer. Use only for communicating findings, asking questions, or suggesting actions. Do not dump raw data here — put that in your note.",
      inputSchema: z.object({
        content: z.string().describe("Markdown comment — keep it concise and actionable"),
      }),
      execute: async ({ content }) => handlers.addComment(content),
    }),

    set_status: tool({
      description: `Update the ticket status. Use "review" after you've left a comment with findings and suggested actions. Use "done" for false positives or resolved items.`,
      inputSchema: z.object({
        status: z.enum(["review", "done"]).describe("The new status"),
      }),
      execute: async ({ status }) => handlers.setStatus(status),
    }),

    set_properties: tool({
      description: "Set priority, labels, and/or linked trace names on the ticket. Call this once you understand the nature and severity of the issue. Use traceNames to link this ticket to specific agent/workflow trace names.",
      inputSchema: z.object({
        priority: z.enum(["none", "low", "medium", "high", "critical"]).optional().describe("Issue priority"),
        labelNames: z.array(z.string()).optional().describe("Label names to apply (must match existing project labels)"),
        traceNames: z.array(z.string()).optional().describe("Trace names this issue is linked to (e.g. the agent or workflow name)"),
      }),
      execute: async ({ priority, labelNames, traceNames }) =>
        handlers.setProperties({ priority, labelNames, traceNames }),
    }),

    schedule_followup: tool({
      description: "Schedule a follow-up investigation after a delay. Either re-check this ticket, or create a new ticket for a separate issue you discovered during research. Use new tickets to keep investigations focused and in scope.",
      inputSchema: z.object({
        delayMinutes: z.number().min(5).max(1440).describe("Minutes to wait (5 min to 24 hours)"),
        reason: z.string().describe("Brief reason for the follow-up"),
        newTicket: z.object({
          title: z.string().describe("Title for the new ticket"),
          description: z.string().describe("Description with context on what to investigate"),
        }).optional().describe("If set, creates a new ticket instead of re-scheduling this one"),
      }),
      execute: async ({ delayMinutes, reason, newTicket }) =>
        handlers.scheduleFollowup({ delayMinutes, reason, newTicket }),
    }),
  };
}
