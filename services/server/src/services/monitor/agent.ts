/**
 * Monitor agent — investigates tickets by querying traces and leaving comments.
 *
 * The agent uses a scratchpad note on the ticket for its working state (research plan,
 * findings, TODOs) and comments only for communicating concise results to the developer.
 */

import { generateText, tool, stepCountIs } from "ai";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getAiModel } from "../explore/ai-provider.js";
import { boss } from "../../shared/lib/boss.js";
import { runSandboxedQuery } from "../../shared/lib/sandboxed-query.js";
import { CLICKHOUSE_SCHEMA } from "../explore/clickhouse-schema.js";
import { db } from "../../shared/db/postgres.js";
import { monitorItems, monitorComments, project } from "../../shared/db/schema.js";
import { createLogger } from "../../shared/lib/logger.js";
import { getTelemetry } from "../../shared/lib/breadcrumb.js";

const log = createLogger("monitor-agent");

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
3. When you have a clear picture, write one concise comment for the developer.
4. Update the ticket status.

Status decisions:
- "review" — Real issue found. Comment should include what you found AND concrete suggested actions.
- "done" (dismissed=true) — False positive or not actionable. Brief comment explaining why.
- Schedule a follow-up — Not enough data yet. Use schedule_followup to check again later.
- "review" — Unsure and need developer input. Comment explains what you found and what you need.

Comment style:
- Write like a senior engineer. Factual, precise, no filler.
- No emojis. No boilerplate section headers.
- Reference specific trace IDs and span names. Include numbers.
- Keep it short — a few sentences to a short paragraph. Tables only if essential (5 rows max).`;

export interface InvestigateOptions {
  projectId: string;
  itemId: string;
}

export async function runInvestigation({ projectId, itemId }: InvestigateOptions) {
  const [item] = await db
    .select()
    .from(monitorItems)
    .where(eq(monitorItems.id, itemId));

  if (!item) {
    log.warn({ itemId }, "monitor item not found");
    return;
  }

  let model;
  try {
    model = await getAiModel(projectId);
  } catch {
    log.warn({ projectId }, "no AI provider configured — skipping investigation");
    await addAgentComment(itemId, "Cannot investigate — no AI provider configured for this project.");
    return;
  }

  // Fetch project memory
  const [proj] = await db
    .select({ agentMemory: project.agentMemory })
    .from(project)
    .where(eq(project.id, projectId));

  // Fetch comment history
  const comments = await db
    .select()
    .from(monitorComments)
    .where(eq(monitorComments.monitorItemId, itemId))
    .orderBy(monitorComments.createdAt);

  // Build messages
  const ticketContext = [
    `## Project Knowledge`,
    proj?.agentMemory || "(no project knowledge yet — use write_file with target 'memory' to record what you learn about this project's agents, their purpose, and how they work)",
    ``,
    `## Ticket`,
    `**${item.title}**`,
    item.description || "(no description)",
    ``,
    `## Ticket Note`,
    item.note || "(empty — start by creating a research plan)",
  ].join("\n");

  const messages: Array<{ role: "user" | "assistant"; content: string }> = [
    { role: "user", content: ticketContext },
  ];

  for (const c of comments) {
    messages.push({
      role: c.source === "agent" ? "assistant" : "user",
      content: c.content,
    });
  }

  // Add instruction based on context
  if (comments.length > 0 && comments[comments.length - 1].source === "user") {
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

  log.info({ projectId, itemId }, "starting investigation");

  try {
    await generateText({
      model,
      system: SYSTEM_PROMPT,
      messages,
      temperature: 0,
      stopWhen: [
        stepCountIs(40),
        async () => {
          const [current] = await db
            .select({ status: monitorItems.status, dismissed: monitorItems.dismissed })
            .from(monitorItems)
            .where(eq(monitorItems.id, itemId));
          if (!current || current.dismissed || current.status === "done") {
            log.info({ itemId }, "item cancelled — stopping investigation");
            return true;
          }
          return false;
        },
      ],
      experimental_telemetry: getTelemetry("monitor-investigate", { itemId, projectId }),
      tools: {
        run_query: tool({
          description: "Execute a read-only ClickHouse SQL query against the project's trace data.",
          inputSchema: z.object({
            sql: z.string().describe("A ClickHouse SELECT query"),
          }),
          execute: async ({ sql }) => {
            log.debug({ projectId, sql }, "running query");
            try {
              const rows = await runSandboxedQuery(projectId, sql, "monitor");
              const truncated = rows.length > 50 ? rows.slice(0, 50) : rows;
              const result = JSON.stringify(truncated, null, 2);
              const note = rows.length > 50 ? `\n(showing 50 of ${rows.length} rows)` : "";
              return `${rows.length} rows returned${note}\n${result}`;
            } catch (err) {
              const msg = err instanceof Error ? err.message : "Query failed";
              log.warn({ projectId, sql, err: msg }, "query failed");
              return `Error: ${msg}`;
            }
          },
        }),

        write_file: tool({
          description: `Overwrite the entire content of a target. Use "note" for the ticket's working scratchpad (research plans, findings, TODOs). Use "memory" for project-wide knowledge (what the agents do, how they work, patterns observed across investigations). Memory persists across all tickets.`,
          inputSchema: z.object({
            target: z.enum(["note", "memory"]).describe("Which document to write"),
            content: z.string().describe("The full content (replaces everything)"),
          }),
          execute: async ({ target, content }) => {
            if (target === "note") {
              await db.update(monitorItems).set({ note: content, updatedAt: new Date() }).where(eq(monitorItems.id, itemId));
            } else {
              await db.update(project).set({ agentMemory: content }).where(eq(project.id, projectId));
            }
            log.debug({ itemId, target }, "write_file");
            return `${target} updated.`;
          },
        }),

        update_file: tool({
          description: `Update a specific section of a target by replacing a substring. Use this to modify part of the note or memory without rewriting everything.`,
          inputSchema: z.object({
            target: z.enum(["note", "memory"]).describe("Which document to update"),
            old_string: z.string().describe("The exact text to find and replace"),
            new_string: z.string().describe("The replacement text"),
          }),
          execute: async ({ target, old_string, new_string }) => {
            const current = target === "note"
              ? item.note
              : proj?.agentMemory ?? "";
            if (!current.includes(old_string)) {
              return `Error: old_string not found in ${target}.`;
            }
            const updated = current.replace(old_string, new_string);
            if (target === "note") {
              await db.update(monitorItems).set({ note: updated, updatedAt: new Date() }).where(eq(monitorItems.id, itemId));
              item.note = updated; // keep local copy in sync
            } else {
              await db.update(project).set({ agentMemory: updated }).where(eq(project.id, projectId));
              if (proj) proj.agentMemory = updated;
            }
            log.debug({ itemId, target }, "update_file");
            return `${target} updated.`;
          },
        }),

        add_comment: tool({
          description: "Leave a concise comment for the developer. Use only for communicating findings, asking questions, or suggesting actions. Do not dump raw data here — put that in your note.",
          inputSchema: z.object({
            content: z.string().describe("Markdown comment — keep it concise and actionable"),
          }),
          execute: async ({ content }) => {
            log.debug({ itemId }, "adding comment");
            await addAgentComment(itemId, content);
            return "Comment added.";
          },
        }),

        set_status: tool({
          description: `Update the ticket status. Use "review" after you've left a comment with findings and suggested actions. Use "done" with dismissed=true for false positives.`,
          inputSchema: z.object({
            status: z.enum(["review", "done"]).describe("The new status"),
            dismissed: z.boolean().optional().describe("Set to true when moving to done as a false positive"),
          }),
          execute: async ({ status, dismissed }) => {
            log.info({ itemId, status, dismissed }, "agent updating status");
            await db
              .update(monitorItems)
              .set({ status, dismissed: dismissed ?? false, updatedAt: new Date() })
              .where(eq(monitorItems.id, itemId));
            return `Status updated to "${status}".`;
          },
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
          execute: async ({ delayMinutes, reason, newTicket }) => {
            if (newTicket) {
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
        }),
      },
    });

    log.info({ projectId, itemId }, "investigation complete");
  } catch (err) {
    log.error({ projectId, itemId, err }, "investigation failed");
    await addAgentComment(
      itemId,
      `Investigation encountered an error: ${err instanceof Error ? err.message : "Unknown error"}`,
    );
  }
}

async function addAgentComment(itemId: string, content: string) {
  await db.insert(monitorComments).values({
    monitorItemId: itemId,
    source: "agent",
    content,
  });
  await db
    .update(monitorItems)
    .set({ read: false, updatedAt: new Date() })
    .where(eq(monitorItems.id, itemId));
}
