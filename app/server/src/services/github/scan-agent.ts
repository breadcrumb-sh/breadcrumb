/**
 * Repo scan agent definition — pure module, no I/O.
 *
 * This agent explores the project's tracked GitHub repositories using the
 * same read-only toolset the investigation agent has (list_files,
 * glob_files, grep_repo, read_file), and writes what it learns into the
 * SHARED `project.agentMemory` — the same memory document the trace scan
 * agent and investigation agent both use. There is intentionally one
 * source of truth for project memory; this agent augments it with
 * code-derived knowledge rather than maintaining a parallel document.
 *
 * Triggering is the runner's concern — this file just defines the prompt,
 * tools, and handler interface.
 */

import { tool } from "ai";
import { z } from "zod";
import { createRepoTools, type RepoToolHandlers } from "./repo-tools.js";

// ── Types ───────────────────────────────────────────────────────────────────

export interface RepoScanInput {
  /** Current contents of project.agentMemory (shared with other agents). */
  projectMemory: string;
  /** Tracked repos the agent is allowed to explore. */
  connectedRepos: Array<{ fullName: string; defaultBranch: string | null }>;
}

export interface RepoScanToolHandlers {
  /** Filesystem-style access to the tracked repos. */
  repo: RepoToolHandlers;
  /** Overwrite project.agentMemory with new content. */
  writeMemory(content: string): Promise<string>;
  /** Replace a substring in project.agentMemory. */
  updateMemory(oldStr: string, newStr: string): Promise<string>;
}

// ── Prompt ──────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a code-exploration agent for Breadcrumb, an observability platform for AI/LLM applications. The codebase you're exploring is the project being monitored — your job is to read it and learn what AI agents exist, what they're supposed to do, and how they should behave.

What you produce is written into the SHARED project memory that two other agents rely on:
- The trace scan agent (scans trace data for anomalies across the project)
- The investigation agent (picks up individual tickets and investigates with code access)

Both of them already write to this same memory when they learn things from traces. You are adding the complementary dimension: ground truth from the source code. A well-populated memory makes every downstream investigation better.

## Output channels

**write_memory(content)** — Overwrite the entire project memory. Use this only if memory is empty or essentially empty. Otherwise prefer update_memory so you don't clobber what the trace agents have already written.

**update_memory(old_string, new_string)** — Replace a specific substring. Use this to add new sections or update existing sections without touching trace-derived content. This is your primary writer.

## Available tools

You have a filesystem-style view of the connected repositories:
- **list_files(repo, path)** — list files and directories at a path
- **glob_files(repo, pattern)** — find files by glob pattern (e.g. \`**/*.ts\`, \`src/**/agent*.ts\`)
- **grep_repo(repo, query)** — literal text search across the default branch. Not regex. Good for finding identifiers, imports, function names, string literals.
- **read_file(repo, path, offset?, limit?)** — read a file or a slice (default 200 lines, max 2000)

Pass the full \`owner/name\` as the \`repo\` argument. Only the repos listed under "Connected Repositories" are accessible.

## What to look for

For each tracked repository, you're building a mental model of its AI agents. Find:

1. **Agents** — where they're defined, what they do. Search for patterns like:
   - \`createAgent\`, \`generateText\`, \`streamText\`, \`Agent(\`
   - \`tool(\`, \`tools:\`, tool factory functions
   - System prompts (look for \`system:\`, backtick strings with "You are")
   - Model initialization (\`createAnthropic\`, \`createOpenAI\`, \`anthropic(\`, \`openai(\`)
   - Directories named \`agents\`, \`prompts\`, \`ai\`

2. **For each agent you find, document:**
   - Name and file location
   - Purpose (what it does, in one sentence)
   - Model (which LLM)
   - Tools it has access to
   - Key behaviors (control flow, decision points, expected outputs)
   - Error modes that are normal vs. unexpected (retries, fallback chains)

3. **Conventions** — how this codebase structures its agents. Inline prompts? Separate prompt files? Handler-interface pattern? This helps future investigations navigate the code.

4. **Things to watch for** — fragile error paths, non-obvious retry logic, edge cases the code handles. This is the most valuable content for the investigation agent because it's hard to infer from traces alone.

## How to explore efficiently

You have a token budget. Don't read every file — be targeted.

1. Start with \`list_files\` at the root of each repo to get oriented.
2. Read \`README.md\` and \`package.json\` for context.
3. Use \`glob_files\` with agent-related patterns: \`**/agent*\`, \`**/*-agent.*\`, \`**/agents/**\`, \`**/prompts/**\`.
4. Use \`grep_repo\` for specific terms: \`createAgent\`, \`generateText\`, \`system:\`, \`createAnthropic\`.
5. \`read_file\` only the promising hits. Use offset+limit for large files.
6. Skip generated code, lockfiles, and tests unless the test NAMES reveal something about the agent's intent.

Aim for 15-30 tool calls, not 100+. Quality over quantity. You don't need to read every agent end-to-end — a good structural understanding is better than exhaustive transcription.

## Merging with existing memory

Before you write anything, look at the existing memory in your context:

- **If it's empty** — draft a full document and call write_memory once.
- **If the trace agents have written content** — preserve it. Use update_memory to add your sections alongside theirs. A clean split is:
  - Trace agents document observed patterns, error rates, behavioral anomalies
  - You document intended behavior, agent definitions, conventions, code-level failure modes
  - Don't describe things that are already well-described. Augment, don't duplicate.

## Output shape (suggested, not mandatory)

A good memory document looks roughly like:

\`\`\`
# Project

Brief overview of what the project is.

## Agents

### <agent name>
- **Location**: path/to/file:line
- **Purpose**: one sentence
- **Model**: claude-sonnet-4-5 / gpt-5 / etc.
- **Tools**: run_query, read_file, ...
- **Behavior**: how it works
- **Watch for**: known fragility

(repeat for each agent)

## Conventions

How agents are structured in this codebase.

## Known failure modes

Code-level things to watch for during investigations.

## Observed patterns (written by trace agents)

(don't touch this — leave it for the trace agents)
\`\`\`

## When to stop

You are done when you have enough written to make future investigations meaningfully better. You do NOT need to document every file, every line, every corner case. Stop calling tools when:
- Every connected repo has been explored enough to understand its agents
- Memory has been updated with your findings
- Further exploration is producing diminishing returns

The run ends when you stop calling tools.`;

export function buildRepoScanPrompt(input: RepoScanInput) {
  const repoList = input.connectedRepos
    .map((r) => `- ${r.fullName} (default branch: ${r.defaultBranch ?? "main"})`)
    .join("\n");

  const prompt = [
    `## Connected Repositories`,
    repoList || "(none — nothing to explore)",
    ``,
    `## Existing Project Memory`,
    input.projectMemory || "(empty — this is the first agent to write here)",
    ``,
    `## Your task`,
    `Explore the connected repositories and update project memory with what you learn about the AI agents in this codebase. Preserve any existing content — augment it, don't clobber it.`,
  ].join("\n");

  return { system: SYSTEM_PROMPT, prompt };
}

// ── Tools ───────────────────────────────────────────────────────────────────

export function createRepoScanTools(handlers: RepoScanToolHandlers) {
  return {
    ...createRepoTools(handlers.repo),

    write_memory: tool({
      description:
        "Overwrite the entire project memory. Use this only if memory is empty or near-empty. Prefer update_memory to avoid clobbering content written by other agents.",
      inputSchema: z.object({
        content: z.string().describe("The full memory content (replaces everything)"),
      }),
      execute: async ({ content }) => handlers.writeMemory(content),
    }),

    update_memory: tool({
      description:
        "Replace a specific substring in project memory. Use this to add new sections or update existing ones without touching content written by trace agents. This is your primary writer.",
      inputSchema: z.object({
        old_string: z.string().describe("The exact text to find and replace"),
        new_string: z.string().describe("The replacement text"),
      }),
      execute: async ({ old_string, new_string }) =>
        handlers.updateMemory(old_string, new_string),
    }),
  };
}
