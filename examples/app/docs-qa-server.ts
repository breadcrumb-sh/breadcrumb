/**
 * Docs Q&A agent — searches Breadcrumb docs files to answer questions.
 *
 * The agent has shell-like tools to explore the docs directory:
 *   - list_files   → list files in a directory
 *   - search_files → grep for a pattern across docs
 *   - read_file    → read a file's contents
 *
 * This produces realistic multi-step traces with tool calls,
 * useful for testing the monitor agent.
 *
 * Run: npm run dev:docs-qa --workspace=examples
 */

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { streamText, tool, stepCountIs } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { init } from "@breadcrumb-sdk/core";
import { initAiSdk } from "@breadcrumb-sdk/ai-sdk";
import { z } from "zod";
import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join, resolve } from "path";
import { readdir, readFile, stat } from "fs/promises";
import { execSync } from "child_process";

// Load .env from examples/ directory
loadEnv({ path: join(dirname(fileURLToPath(import.meta.url)), "../.env") });

const apiKey = process.env["BREADCRUMB_API_KEY"];
if (!apiKey) {
  console.error("Missing BREADCRUMB_API_KEY in examples/.env");
  process.exit(1);
}

if (!process.env["OPENROUTER_API_KEY"]) {
  console.error("Missing OPENROUTER_API_KEY in examples/.env");
  process.exit(1);
}

const bc = init({
  apiKey,
  baseUrl: process.env["BREADCRUMB_BASE_URL"] ?? "http://localhost:3100",
});

const { telemetry } = initAiSdk(bc);

const openrouter = createOpenRouter({
  apiKey: process.env["OPENROUTER_API_KEY"] ?? "",
});

const MODEL = process.env["MODEL"] ?? "anthropic/claude-3.5-haiku";

// Docs root — the actual Breadcrumb docs
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DOCS_ROOT = join(REPO_ROOT, "apps/docs/content/docs");

// ── Tool implementations ────────────────────────────────────────────────────

function safePath(relativePath: string): string {
  const resolved = resolve(DOCS_ROOT, relativePath);
  if (!resolved.startsWith(DOCS_ROOT)) {
    throw new Error("Path traversal not allowed");
  }
  return resolved;
}

async function listFiles(dir: string): Promise<string[]> {
  const absDir = safePath(dir);
  const entries = await readdir(absDir, { withFileTypes: true });
  return entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
}

async function readFileContent(filePath: string): Promise<string> {
  const abs = safePath(filePath);
  const s = await stat(abs);
  if (s.size > 50_000) return "(file too large, >50KB)";
  return readFile(abs, "utf-8");
}

function searchFiles(pattern: string): string {
  try {
    const result = execSync(
      `grep -rl --include="*.mdx" --include="*.md" ${JSON.stringify(pattern)} .`,
      { cwd: DOCS_ROOT, encoding: "utf-8", timeout: 5000 },
    );
    return result.trim() || "No matches found.";
  } catch {
    return "No matches found.";
  }
}

function searchWithContext(pattern: string): string {
  try {
    const result = execSync(
      `grep -rn --include="*.mdx" --include="*.md" -C 2 ${JSON.stringify(pattern)} .`,
      { cwd: DOCS_ROOT, encoding: "utf-8", timeout: 5000 },
    );
    // Limit output
    const lines = result.split("\n");
    if (lines.length > 60) {
      return lines.slice(0, 60).join("\n") + `\n... (${lines.length - 60} more lines)`;
    }
    return result.trim() || "No matches found.";
  } catch {
    return "No matches found.";
  }
}

// ── Hono app ────────────────────────────────────────────────────────────────

const app = new Hono();

// Serve the docs-qa UI
app.get("/", async (c) => {
  const html = await readFile(join(dirname(fileURLToPath(import.meta.url)), "docs-qa.html"), "utf-8");
  return c.html(html);
});

// Simple in-memory message history per session
const sessions = new Map<string, Array<{ role: "user" | "assistant"; content: string }>>();

app.post("/api/ask", async (c) => {
  const { question, sessionId = "default" } = await c.req.json<{ question: string; sessionId?: string }>();

  if (!question?.trim()) {
    return c.json({ error: "No question provided" }, 400);
  }

  console.log(`\n[ask] ${question}`);

  if (!sessions.has(sessionId)) sessions.set(sessionId, []);
  const history = sessions.get(sessionId)!;
  history.push({ role: "user", content: question });

  const system = `You are a helpful documentation assistant for Breadcrumb, an LLM tracing and observability platform.

You have access to tools that let you search and read the actual documentation files. Use them to find accurate answers.

Rules:
- Always search the docs before answering — do not guess or use prior knowledge about Breadcrumb.
- If you can't find the answer in the docs, say so honestly.
- Quote relevant sections when helpful.
- Be concise but thorough.
- If the question is ambiguous, search for multiple interpretations.`;

  const result = streamText({
    model: openrouter.chat(MODEL, { usage: { include: true } }),
    system,
    messages: history.map((m) => ({ role: m.role, content: m.content })),
    stopWhen: stepCountIs(8),
    experimental_telemetry: telemetry("docs-qa", { userMessage: question }),
    tools: {
      list_files: tool({
        description: "List files and directories in the docs folder. Pass '.' for the root.",
        inputSchema: z.object({
          path: z.string().describe("Relative path within the docs directory"),
        }),
        execute: async ({ path }) => {
          console.log(`  [tool] list_files: ${path}`);
          return bc.span("list-files", async (span) => {
            const files = await listFiles(path);
            span.set({ input: path, output: files.join("\n") });
            return { path, files };
          }, { type: "tool" });
        },
      }),

      search_files: tool({
        description: "Search for a text pattern across all doc files. Returns matching file paths.",
        inputSchema: z.object({
          pattern: z.string().describe("Text pattern to search for"),
        }),
        execute: async ({ pattern }) => {
          console.log(`  [tool] search_files: ${pattern}`);
          return bc.span("search-files", async (span) => {
            const matches = searchFiles(pattern);
            span.set({ input: pattern, output: matches });
            return { pattern, matches };
          }, { type: "tool" });
        },
      }),

      search_with_context: tool({
        description: "Search for a pattern and return matching lines with surrounding context. Use this when you need to see the actual content around matches.",
        inputSchema: z.object({
          pattern: z.string().describe("Text pattern to search for"),
        }),
        execute: async ({ pattern }) => {
          console.log(`  [tool] search_with_context: ${pattern}`);
          return bc.span("search-context", async (span) => {
            const results = searchWithContext(pattern);
            span.set({ input: pattern, output: results });
            return { pattern, results };
          }, { type: "tool" });
        },
      }),

      read_file: tool({
        description: "Read the full contents of a documentation file.",
        inputSchema: z.object({
          path: z.string().describe("Relative path to the file within docs directory"),
        }),
        execute: async ({ path }) => {
          console.log(`  [tool] read_file: ${path}`);
          return bc.span("read-file", async (span) => {
            const content = await readFileContent(path);
            span.set({ input: path, output: content.slice(0, 200) + "..." });
            return { path, content };
          }, { type: "tool" });
        },
      }),
    },
  });

  // Capture full text for history after stream completes
  result.text.then((text) => {
    history.push({ role: "assistant", content: text });
    // Keep history bounded
    if (history.length > 20) history.splice(0, history.length - 20);
  });

  return result.toTextStreamResponse();
});

const PORT = Number(process.env["DOCS_QA_PORT"] ?? 3201);
serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`Docs Q&A → http://localhost:${PORT}`);
  console.log(`Docs root: ${DOCS_ROOT}`);
  console.log(`Model: ${MODEL}`);
});
