/**
 * Seed script — populates a demo project with realistic test traces.
 *
 * Usage:
 *   npm run seed                (from services/server)
 *
 * Creates:
 *   - A Postgres project + API key
 *   - Several ClickHouse traces and spans covering common patterns:
 *       1. Simple LLM call
 *       2. Multi-step agent with tool calls
 *       3. RAG pipeline (retrieval + generation)
 *       4. Failed/error trace
 */

import "dotenv/config";
import { randomBytes } from "node:crypto";
import { db } from "../src/db/index.js";
import { projects, apiKeys } from "../src/db/schema.js";
import { clickhouse, runClickhouseMigrations } from "../src/db/clickhouse.js";
import { generateApiKey, hashApiKey, getKeyPrefix } from "../src/lib/api-keys.js";

// ── ID helpers ────────────────────────────────────────────────────────────────

const traceId = () => randomBytes(16).toString("hex"); // 32-char hex
const spanId  = () => randomBytes(8).toString("hex");  // 16-char hex

// ── Cost/time helpers ─────────────────────────────────────────────────────────

const usd = (dollars: number) => Math.round(dollars * 1_000_000); // → micro-dollars

// ClickHouse DateTime64 expects "YYYY-MM-DD HH:MM:SS.mmm" — not ISO 8601.
const chDate = (d: Date) =>
  d.toISOString().replace("T", " ").replace("Z", "");

/** Return a ClickHouse timestamp offset by `ms` milliseconds before now. */
const ago = (ms: number) => chDate(new Date(Date.now() - ms));

/** Return a ClickHouse timestamp offset by `ms` milliseconds after `from`. */
const after = (from: string, ms: number) =>
  chDate(new Date(new Date(from.replace(" ", "T") + "Z").getTime() + ms));

const json = (v: unknown) => JSON.stringify(v);

// ── Span / trace builders ─────────────────────────────────────────────────────

function makeTrace(projectId: string, opts: {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  status?: "ok" | "error";
  statusMessage?: string;
  input?: unknown;
  output?: unknown;
  userId?: string;
  sessionId?: string;
  environment?: string;
}) {
  return {
    id:             opts.id,
    project_id:     projectId,
    version:        Date.now(),
    name:           opts.name,
    start_time:     opts.startTime,
    end_time:       opts.endTime,
    status:         opts.status ?? "ok",
    status_message: opts.statusMessage ?? "",
    input:          json(opts.input ?? null),
    output:         json(opts.output ?? null),
    user_id:        opts.userId ?? "",
    session_id:     opts.sessionId ?? "",
    environment:    opts.environment ?? "development",
    tags:           {},
  };
}

function makeLlmSpan(projectId: string, opts: {
  id: string;
  traceId: string;
  parentId?: string;
  name: string;
  startTime: string;
  endTime: string;
  provider: string;
  model: string;
  inputMessages: unknown[];
  outputContent: string;
  inputTokens: number;
  outputTokens: number;
  inputCostUsd: number;
  outputCostUsd: number;
  status?: "ok" | "error";
  statusMessage?: string;
}) {
  return {
    id:             opts.id,
    trace_id:       opts.traceId,
    parent_span_id: opts.parentId ?? "",
    project_id:     projectId,
    name:           opts.name,
    type:           "llm",
    start_time:     opts.startTime,
    end_time:       opts.endTime,
    status:         opts.status ?? "ok",
    status_message: opts.statusMessage ?? "",
    input:          json(opts.inputMessages),
    output:         json({ role: "assistant", content: opts.outputContent }),
    provider:       opts.provider,
    model:          opts.model,
    input_tokens:   opts.inputTokens,
    output_tokens:  opts.outputTokens,
    input_cost_usd:  usd(opts.inputCostUsd),
    output_cost_usd: usd(opts.outputCostUsd),
    metadata:       {},
  };
}

function makeToolSpan(projectId: string, opts: {
  id: string;
  traceId: string;
  parentId: string;
  name: string;
  startTime: string;
  endTime: string;
  input: unknown;
  output: unknown;
  status?: "ok" | "error";
}) {
  return {
    id:             opts.id,
    trace_id:       opts.traceId,
    parent_span_id: opts.parentId,
    project_id:     projectId,
    name:           opts.name,
    type:           "tool",
    start_time:     opts.startTime,
    end_time:       opts.endTime,
    status:         opts.status ?? "ok",
    status_message: "",
    input:          json(opts.input),
    output:         json(opts.output),
    provider:       "",
    model:          "",
    input_tokens:   0,
    output_tokens:  0,
    input_cost_usd:  0,
    output_cost_usd: 0,
    metadata:       {},
  };
}

function makeChainSpan(projectId: string, opts: {
  id: string;
  traceId: string;
  parentId?: string;
  name: string;
  startTime: string;
  endTime: string;
}) {
  return {
    id:             opts.id,
    trace_id:       opts.traceId,
    parent_span_id: opts.parentId ?? "",
    project_id:     projectId,
    name:           opts.name,
    type:           "step",
    start_time:     opts.startTime,
    end_time:       opts.endTime,
    status:         "ok",
    status_message: "",
    input:          "",
    output:         "",
    provider:       "",
    model:          "",
    input_tokens:   0,
    output_tokens:  0,
    input_cost_usd:  0,
    output_cost_usd: 0,
    metadata:       {},
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function seed() {
  console.log("running clickhouse migrations...");
  await runClickhouseMigrations();

  // ── Project + API key ──────────────────────────────────────────────────────

  console.log("creating demo project...");
  const [project] = await db
    .insert(projects)
    .values({ name: "Demo Project" })
    .returning();

  const rawKey = generateApiKey();
  await db.insert(apiKeys).values({
    projectId: project.id,
    name: "Seed key",
    keyHash: hashApiKey(rawKey),
    keyPrefix: getKeyPrefix(rawKey),
  });

  console.log(`  project id : ${project.id}`);
  console.log(`  api key    : ${rawKey}`);

  const pid = project.id;

  // ── Trace 1: Simple chat completion ───────────────────────────────────────
  // A single LLM call. The most common pattern.

  const t1 = traceId();
  const t1Start = ago(3 * 60 * 60 * 1000); // 3 hours ago
  const t1LlmStart = after(t1Start, 5);
  const t1LlmEnd = after(t1LlmStart, 820);
  const t1End = after(t1LlmEnd, 3);

  const trace1 = makeTrace(pid, {
    id: t1, name: "chat_completion",
    startTime: t1Start, endTime: t1End,
    input:  { message: "What is the capital of France?" },
    output: { message: "The capital of France is Paris." },
    userId: "user_alice", sessionId: "sess_001", environment: "production",
  });

  const spans1 = [
    makeLlmSpan(pid, {
      id: spanId(), traceId: t1,
      name: "gpt-4o-mini",
      startTime: t1LlmStart, endTime: t1LlmEnd,
      provider: "openai", model: "gpt-4o-mini",
      inputMessages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user",   content: "What is the capital of France?" },
      ],
      outputContent: "The capital of France is Paris.",
      inputTokens: 24, outputTokens: 9,
      inputCostUsd: 0.0000036, outputCostUsd: 0.0000054,
    }),
  ];

  // ── Trace 2: Agent with tool calls ────────────────────────────────────────
  // LLM decides to call two tools, then synthesises a final answer.

  const t2 = traceId();
  const t2Start = ago(2 * 60 * 60 * 1000); // 2 hours ago
  const t2AgentStart = after(t2Start, 2);

  const t2Llm1Start = after(t2AgentStart, 10);
  const t2Llm1End   = after(t2Llm1Start, 1100);

  const t2Tool1Start = after(t2Llm1End, 5);
  const t2Tool1End   = after(t2Tool1Start, 340);

  const t2Tool2Start = after(t2Tool1End, 5);
  const t2Tool2End   = after(t2Tool2Start, 210);

  const t2Llm2Start = after(t2Tool2End, 10);
  const t2Llm2End   = after(t2Llm2Start, 1450);

  const t2AgentEnd = after(t2Llm2End, 5);
  const t2End = after(t2AgentEnd, 3);

  const t2AgentId = spanId();

  const trace2 = makeTrace(pid, {
    id: t2, name: "research_agent",
    startTime: t2Start, endTime: t2End,
    input:  { query: "What is the current price of Bitcoin and how does it compare to last week?" },
    output: { answer: "Bitcoin is currently trading at $67,432, up 4.2% from last week's $64,712." },
    userId: "user_bob", sessionId: "sess_002", environment: "production",
  });

  const spans2 = [
    makeChainSpan(pid, {
      id: t2AgentId, traceId: t2,
      name: "agent_loop",
      startTime: t2AgentStart, endTime: t2AgentEnd,
    }),
    makeLlmSpan(pid, {
      id: spanId(), traceId: t2, parentId: t2AgentId,
      name: "claude-3-5-haiku — plan",
      startTime: t2Llm1Start, endTime: t2Llm1End,
      provider: "anthropic", model: "claude-3-5-haiku-20251001",
      inputMessages: [
        { role: "user", content: "What is the current price of Bitcoin and how does it compare to last week?" },
      ],
      outputContent: "I'll look up the current Bitcoin price and last week's price.",
      inputTokens: 142, outputTokens: 38,
      inputCostUsd: 0.0000284, outputCostUsd: 0.000019,
    }),
    makeToolSpan(pid, {
      id: spanId(), traceId: t2, parentId: t2AgentId,
      name: "get_crypto_price",
      startTime: t2Tool1Start, endTime: t2Tool1End,
      input:  { symbol: "BTC", currency: "USD" },
      output: { price: 67432, currency: "USD", timestamp: t2Tool1End },
    }),
    makeToolSpan(pid, {
      id: spanId(), traceId: t2, parentId: t2AgentId,
      name: "get_crypto_price",
      startTime: t2Tool2Start, endTime: t2Tool2End,
      input:  { symbol: "BTC", currency: "USD", date: "7d_ago" },
      output: { price: 64712, currency: "USD", timestamp: t2Tool2End },
    }),
    makeLlmSpan(pid, {
      id: spanId(), traceId: t2, parentId: t2AgentId,
      name: "claude-3-5-haiku — answer",
      startTime: t2Llm2Start, endTime: t2Llm2End,
      provider: "anthropic", model: "claude-3-5-haiku-20251001",
      inputMessages: [
        { role: "user",      content: "What is the current price of Bitcoin and how does it compare to last week?" },
        { role: "assistant", content: "I'll look up the current Bitcoin price and last week's price." },
        { role: "tool",      content: JSON.stringify({ price: 67432 }) },
        { role: "tool",      content: JSON.stringify({ price: 64712 }) },
      ],
      outputContent: "Bitcoin is currently trading at $67,432, up 4.2% from last week's $64,712.",
      inputTokens: 289, outputTokens: 62,
      inputCostUsd: 0.0000578, outputCostUsd: 0.000031,
    }),
  ];

  // ── Trace 3: RAG pipeline ─────────────────────────────────────────────────
  // Retrieval step followed by a generation step.

  const t3 = traceId();
  const t3Start = ago(1 * 60 * 60 * 1000); // 1 hour ago

  const t3RetrievalStart = after(t3Start, 3);
  const t3RetrievalEnd   = after(t3RetrievalStart, 180);

  const t3LlmStart = after(t3RetrievalEnd, 8);
  const t3LlmEnd   = after(t3LlmStart, 1230);
  const t3End = after(t3LlmEnd, 3);

  const trace3 = makeTrace(pid, {
    id: t3, name: "rag_query",
    startTime: t3Start, endTime: t3End,
    input:  { question: "How do I reset my password?" },
    output: { answer: "To reset your password, go to Settings > Security > Reset Password." },
    userId: "user_carol", sessionId: "sess_003", environment: "production",
  });

  const spans3 = [
    {
      id: spanId(), trace_id: t3, parent_span_id: "", project_id: pid,
      name: "vector_search", type: "retrieval",
      start_time: t3RetrievalStart, end_time: t3RetrievalEnd,
      status: "ok", status_message: "",
      input:  json({ query: "reset password", top_k: 3 }),
      output: json([
        { id: "doc_42", score: 0.94, text: "To reset your password..." },
        { id: "doc_17", score: 0.81, text: "Password requirements..." },
      ]),
      provider: "", model: "",
      input_tokens: 0, output_tokens: 0,
      input_cost_usd: 0, output_cost_usd: 0,
      metadata: { index: "help-docs", latency_ms: "178" },
    },
    makeLlmSpan(pid, {
      id: spanId(), traceId: t3,
      name: "gpt-4o — answer",
      startTime: t3LlmStart, endTime: t3LlmEnd,
      provider: "openai", model: "gpt-4o",
      inputMessages: [
        { role: "system", content: "Answer using only the provided context." },
        { role: "user",   content: "How do I reset my password?\n\nContext: To reset your password, go to Settings > Security > Reset Password." },
      ],
      outputContent: "To reset your password, go to Settings > Security > Reset Password.",
      inputTokens: 198, outputTokens: 22,
      inputCostUsd: 0.000099, outputCostUsd: 0.000044,
    }),
  ];

  // ── Trace 4: Error trace ──────────────────────────────────────────────────
  // LLM call that fails (e.g. rate limit / context length exceeded).

  const t4 = traceId();
  const t4Start = ago(20 * 60 * 1000); // 20 minutes ago
  const t4LlmStart = after(t4Start, 4);
  const t4LlmEnd   = after(t4LlmStart, 320);
  const t4End = after(t4LlmEnd, 2);

  const trace4 = makeTrace(pid, {
    id: t4, name: "chat_completion",
    startTime: t4Start, endTime: t4End,
    status: "error", statusMessage: "Rate limit exceeded",
    input: { message: "Summarise this document..." },
    userId: "user_alice", sessionId: "sess_004", environment: "production",
  });

  const spans4 = [
    makeLlmSpan(pid, {
      id: spanId(), traceId: t4,
      name: "gpt-4o",
      startTime: t4LlmStart, endTime: t4LlmEnd,
      provider: "openai", model: "gpt-4o",
      inputMessages: [
        { role: "user", content: "Summarise this document..." },
      ],
      outputContent: "",
      inputTokens: 0, outputTokens: 0,
      inputCostUsd: 0, outputCostUsd: 0,
      status: "error", statusMessage: "429 Rate limit exceeded. Please retry after 60s.",
    }),
  ];

  // ── Insert everything ──────────────────────────────────────────────────────

  console.log("inserting traces...");
  await clickhouse.insert({
    table: "breadcrumb.traces",
    format: "JSONEachRow",
    values: [trace1, trace2, trace3, trace4],
  });

  console.log("inserting spans...");
  await clickhouse.insert({
    table: "breadcrumb.spans",
    format: "JSONEachRow",
    values: [...spans1, ...spans2, ...spans3, ...spans4],
  });

  console.log("\ndone!");
  console.log(`  4 traces inserted`);
  console.log(`  ${spans1.length + spans2.length + spans3.length + spans4.length} spans inserted`);
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
