/**
 * Scan agent definition — pure module, no I/O.
 *
 * Exports the prompt builder, tool factory, and handler interface.
 * Used by both the production runner (scan.ts) and evals.
 */

import { tool } from "ai";
import { z } from "zod";
import { CLICKHOUSE_SCHEMA } from "../explore/clickhouse-schema.js";

// ── Types ───────────────────────────────────────────────────────────────────

export interface ScanInput {
  projectMemory: string;
}

export interface ScanToolHandlers {
  runQuery(sql: string): Promise<string>;
  writeMemory(content: string): Promise<string>;
  updateMemory(oldStr: string, newStr: string): Promise<string>;
  createTicket(title: string, description: string, delayMinutes?: number): Promise<string>;
}

// ── Prompt ──────────────────────────────────────────────────────────────────

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

export function buildScanPrompt(input: ScanInput) {
  const context = [
    `## Project Knowledge`,
    input.projectMemory || "(no project knowledge yet — use write_file with target 'memory' to record what you learn about this project's agents, their purpose, and how they work)",
  ].join("\n");

  return {
    system: SCAN_SYSTEM,
    prompt: `${context}\n\nScan recent traces for this project. Query the data to understand what's happening, update project knowledge, and create tickets for any issues worth investigating.`,
  };
}

// ── Tools ───────────────────────────────────────────────────────────────────

export function createScanTools(handlers: ScanToolHandlers) {
  return {
    run_query: tool({
      description: "Execute a read-only ClickHouse SQL query against the project's trace data.",
      inputSchema: z.object({
        sql: z.string().describe("A ClickHouse SELECT query"),
      }),
      execute: async ({ sql }) => handlers.runQuery(sql),
    }),

    write_file: tool({
      description: `Overwrite project knowledge (memory). Use this to record what you learn about the project's agents, their behavior, and common patterns. This persists across all scans and investigations.`,
      inputSchema: z.object({
        content: z.string().describe("The full content (replaces everything)"),
      }),
      execute: async ({ content }) => handlers.writeMemory(content),
    }),

    update_file: tool({
      description: `Update a specific section of project knowledge by replacing a substring.`,
      inputSchema: z.object({
        old_string: z.string().describe("The exact text to find and replace"),
        new_string: z.string().describe("The replacement text"),
      }),
      execute: async ({ old_string, new_string }) => handlers.updateMemory(old_string, new_string),
    }),

    create_ticket: tool({
      description: "Create a new monitoring ticket for an issue worth investigating. The investigation agent will pick it up.",
      inputSchema: z.object({
        title: z.string().describe("Short, specific title"),
        description: z.string().describe("Context on what to investigate and why"),
        delayMinutes: z.number().min(0).max(1440).optional().describe("Minutes before investigation starts (0 = immediately, default 0)"),
      }),
      execute: async ({ title, description, delayMinutes }) =>
        handlers.createTicket(title, description, delayMinutes),
    }),
  };
}
