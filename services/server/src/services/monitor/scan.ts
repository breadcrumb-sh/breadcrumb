/**
 * Monitor scan agent — proactively explores traces to find issues worth investigating.
 *
 * Triggered by trace ingestion (debounced). The agent queries traces on its own,
 * uses project memory for context, and creates tickets for anything worth looking into.
 */

import { generateText, tool, stepCountIs } from "ai";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getAiModel } from "../explore/ai-provider.js";
import { boss } from "../../shared/lib/boss.js";
import { runSandboxedQuery } from "../../shared/lib/sandboxed-query.js";
import { CLICKHOUSE_SCHEMA } from "../explore/clickhouse-schema.js";
import { db } from "../../shared/db/postgres.js";
import { monitorItems, project } from "../../shared/db/schema.js";
import { createLogger } from "../../shared/lib/logger.js";
import { getTelemetry } from "../../shared/lib/breadcrumb.js";
import { recordUsage } from "./usage.js";

const log = createLogger("monitor-scan");

const SCAN_SYSTEM = `You are a monitoring agent that proactively scans trace data from an AI/LLM application to find issues worth investigating.

You are scanning agent traces — not traditional request logs. They capture multi-step AI reasoning: LLM calls, tool invocations, retrieval steps, and orchestration logic. Understand that:
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

Your job:
1. Query recent traces to understand what's happening in the project.
2. Update project knowledge (memory) with anything new you learn about the project's agents.
3. If you find something worth investigating, create a ticket for it.
4. If everything looks healthy, just update memory and finish.

Approach:
- Start by understanding what types of traces exist and their recent patterns.
- Look for anomalies: unusual error rates, degraded performance, behavioral changes.
- Focus on semantic issues — not just errors, but reasoning quality, intent alignment, retrieval relevance.
- Use project knowledge to understand what's normal vs abnormal.
- Keep scans efficient — a few targeted queries, not exhaustive exploration.
- When creating tickets, write clear titles and descriptions so the investigation agent knows what to look into.`;

export async function runScan(projectId: string) {
  let model;
  try {
    model = await getAiModel(projectId);
  } catch {
    log.warn({ projectId }, "no AI provider configured — skipping scan");
    return;
  }

  // Fetch project memory
  const [proj] = await db
    .select({ agentMemory: project.agentMemory })
    .from(project)
    .where(eq(project.id, projectId));

  const context = [
    `## Project Knowledge`,
    proj?.agentMemory || "(no project knowledge yet — use write_file with target 'memory' to record what you learn about this project's agents, their purpose, and how they work)",
  ].join("\n");

  log.info({ projectId }, "starting scan");

  try {
    const result = await generateText({
      model,
      system: SCAN_SYSTEM,
      prompt: `${context}\n\nScan recent traces for this project. Query the data to understand what's happening, update project knowledge, and create tickets for any issues worth investigating.`,
      temperature: 0,
      stopWhen: stepCountIs(40),
      experimental_telemetry: getTelemetry("monitor-scan", { projectId }),
      tools: {
        run_query: tool({
          description: "Execute a read-only ClickHouse SQL query against the project's trace data.",
          inputSchema: z.object({
            sql: z.string().describe("A ClickHouse SELECT query"),
          }),
          execute: async ({ sql }) => {
            log.debug({ projectId, sql }, "scan query");
            try {
              const rows = await runSandboxedQuery(projectId, sql, "monitor-scan");
              const truncated = rows.length > 50 ? rows.slice(0, 50) : rows;
              const result = JSON.stringify(truncated, null, 2);
              const note = rows.length > 50 ? `\n(showing 50 of ${rows.length} rows)` : "";
              return `${rows.length} rows returned${note}\n${result}`;
            } catch (err) {
              const msg = err instanceof Error ? err.message : "Query failed";
              log.warn({ projectId, sql, err: msg }, "scan query failed");
              return `Error: ${msg}`;
            }
          },
        }),

        write_file: tool({
          description: `Overwrite project knowledge (memory). Use this to record what you learn about the project's agents, their behavior, and common patterns. This persists across all scans and investigations.`,
          inputSchema: z.object({
            content: z.string().describe("The full content (replaces everything)"),
          }),
          execute: async ({ content }) => {
            await db.update(project).set({ agentMemory: content }).where(eq(project.id, projectId));
            if (proj) proj.agentMemory = content;
            log.debug({ projectId }, "scan updated memory");
            return "Memory updated.";
          },
        }),

        update_file: tool({
          description: `Update a specific section of project knowledge by replacing a substring.`,
          inputSchema: z.object({
            old_string: z.string().describe("The exact text to find and replace"),
            new_string: z.string().describe("The replacement text"),
          }),
          execute: async ({ old_string, new_string }) => {
            const current = proj?.agentMemory ?? "";
            if (!current.includes(old_string)) {
              return "Error: old_string not found in memory.";
            }
            const updated = current.replace(old_string, new_string);
            await db.update(project).set({ agentMemory: updated }).where(eq(project.id, projectId));
            if (proj) proj.agentMemory = updated;
            log.debug({ projectId }, "scan updated memory section");
            return "Memory updated.";
          },
        }),

        create_ticket: tool({
          description: "Create a new monitoring ticket for an issue worth investigating. The investigation agent will pick it up.",
          inputSchema: z.object({
            title: z.string().describe("Short, specific title"),
            description: z.string().describe("Context on what to investigate and why"),
            delayMinutes: z.number().min(0).max(1440).optional().describe("Minutes before investigation starts (0 = immediately, default 0)"),
          }),
          execute: async ({ title, description, delayMinutes }) => {
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
        }),
      },
    });

    const input = result.usage?.inputTokens ?? 0;
    const output = result.usage?.outputTokens ?? 0;
    const costCents = Math.ceil((input * 3 + output * 15) / 1_000_000 * 100);
    await recordUsage(projectId, input, output, costCents);
    log.info({ projectId, inputTokens: input, outputTokens: output, costCents }, "scan complete");
  } catch (err) {
    log.error({ projectId, err }, "scan failed");
  }
}
