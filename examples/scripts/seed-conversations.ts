/**
 * seed-conversations — simulates realistic multi-turn chat conversations
 * with tool calls, varying patterns, realistic timing, and backdated timestamps.
 *
 * Uses IngestClient directly (instead of the SDK) so traces spread across the
 * last 30 days, giving the dashboard meaningful time-series data.
 *
 * Run: tsx scripts/seed-conversations.ts [count]
 * Or:  npm run seed-conversations --workspace=examples
 *
 * Arguments:
 *   count  Number of conversations to simulate (default: 10)
 *
 * Example:
 *   tsx scripts/seed-conversations.ts 100
 */

import { IngestClient, generateTraceId, generateSpanId } from "@breadcrumb/core";
import type { TracePayload, SpanPayload } from "@breadcrumb/core";
import { config } from "../config.js";

const COUNT = parseInt(process.argv[2] ?? "10", 10);
const DAYS_BACK = 30;

// ── Data pools ───────────────────────────────────────────────────────────────

const MODELS = [
  { id: "anthropic/claude-3.5-haiku", provider: "anthropic", inputCostPer1k: 0.0008, outputCostPer1k: 0.004 },
  { id: "anthropic/claude-sonnet-4-6", provider: "anthropic", inputCostPer1k: 0.003, outputCostPer1k: 0.015 },
  { id: "anthropic/claude-opus-4", provider: "anthropic", inputCostPer1k: 0.015, outputCostPer1k: 0.075 },
  { id: "openai/gpt-4o", provider: "openai", inputCostPer1k: 0.0025, outputCostPer1k: 0.01 },
  { id: "openai/gpt-4o-mini", provider: "openai", inputCostPer1k: 0.00015, outputCostPer1k: 0.0006 },
  { id: "openai/gpt-4.1-nano", provider: "openai", inputCostPer1k: 0.0001, outputCostPer1k: 0.0004 },
  { id: "google/gemini-2.0-flash", provider: "google", inputCostPer1k: 0.0001, outputCostPer1k: 0.0004 },
  { id: "google/gemini-2.5-pro", provider: "google", inputCostPer1k: 0.00125, outputCostPer1k: 0.01 },
];

const USERS = ["user-alice", "user-bob", "user-charlie", "user-diana", "user-eve", "user-frank", undefined, undefined];

const ENVIRONMENTS = ["production", "production", "production", "production", "staging", "staging", "development"];

const CITIES = ["Paris", "London", "Tokyo", "New York", "Berlin", "Sydney", "Cairo", "São Paulo", "Toronto", "Mumbai", "Seoul", "Amsterdam"];

const WEATHER_CONDITIONS = ["Partly cloudy", "Sunny", "Overcast", "Light rain", "Clear", "Fog", "Thunderstorms", "Snow", "Windy", "Haze"];

const WIKI_TOPICS = [
  "Quantum computing", "Black holes", "Roman Empire", "Machine learning",
  "Photosynthesis", "Renaissance art", "Bitcoin", "DNA replication",
  "Climate change", "General relativity", "Artificial intelligence",
  "The Great Wall of China", "Plate tectonics", "Neural networks",
  "CRISPR gene editing", "The French Revolution", "Blockchain technology",
  "Dark matter", "Natural language processing", "The Industrial Revolution",
];

const TRACE_NAMES = [
  "chat", "chat", "chat", "chat",         // weighted: most common
  "search", "search",
  "summarize",
  "code-review",
  "translate",
  "data-analysis",
];

interface Turn {
  message: string;
  expectsTools: ("weather" | "wiki")[];
}

const CONVERSATION_STARTERS: Turn[] = [
  { message: "What's the weather like in Paris right now?", expectsTools: ["weather"] },
  { message: "Tell me about quantum computing", expectsTools: ["wiki"] },
  { message: "What's the weather in Tokyo and what can you tell me about Japanese history?", expectsTools: ["weather", "wiki"] },
  { message: "Compare the weather in London and Berlin", expectsTools: ["weather", "weather"] },
  { message: "Can you explain black holes to me?", expectsTools: ["wiki"] },
  { message: "I'm traveling to New York tomorrow, what's the weather?", expectsTools: ["weather"] },
  { message: "What do you know about the Roman Empire?", expectsTools: ["wiki"] },
  { message: "What's it like outside in Sydney? Also tell me about climate change", expectsTools: ["weather", "wiki"] },
  { message: "Hello! How are you today?", expectsTools: [] },
  { message: "Can you help me understand machine learning?", expectsTools: ["wiki"] },
  { message: "What's the weather in Cairo, Mumbai, and Toronto?", expectsTools: ["weather", "weather", "weather"] },
  { message: "Tell me about DNA replication and neural networks", expectsTools: ["wiki", "wiki"] },
  { message: "What's a good recipe for pasta?", expectsTools: [] },
  { message: "Summarize the concept of general relativity for me", expectsTools: ["wiki"] },
  { message: "Check the weather in São Paulo please", expectsTools: ["weather"] },
  { message: "Explain CRISPR gene editing in simple terms", expectsTools: ["wiki"] },
  { message: "What's the weather in Seoul and Amsterdam?", expectsTools: ["weather", "weather"] },
  { message: "Tell me about the French Revolution and the Industrial Revolution", expectsTools: ["wiki", "wiki"] },
];

const FOLLOWUPS: Turn[] = [
  { message: "What about tomorrow?", expectsTools: [] },
  { message: "Can you tell me more about that?", expectsTools: [] },
  { message: "What's the weather in London too?", expectsTools: ["weather"] },
  { message: "Also look up Bitcoin for me", expectsTools: ["wiki"] },
  { message: "Thanks! Now check Berlin weather", expectsTools: ["weather"] },
  { message: "Interesting. What about artificial intelligence?", expectsTools: ["wiki"] },
  { message: "Can you compare that with Tokyo weather?", expectsTools: ["weather"] },
  { message: "Tell me more about photosynthesis", expectsTools: ["wiki"] },
  { message: "That's helpful, thanks!", expectsTools: [] },
  { message: "Could you also check the weather in Sydney?", expectsTools: ["weather"] },
  { message: "What about plate tectonics?", expectsTools: ["wiki"] },
  { message: "Perfect. One more thing — what's it like in Cairo?", expectsTools: ["weather"] },
  { message: "How does this relate to blockchain technology?", expectsTools: ["wiki"] },
  { message: "Summarize everything so far", expectsTools: [] },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function randInt(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min));
}

function randFloat(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function computeCost(model: typeof MODELS[number], inputTokens: number, outputTokens: number) {
  return {
    input_cost_usd: (inputTokens / 1000) * model.inputCostPer1k,
    output_cost_usd: (outputTokens / 1000) * model.outputCostPer1k,
  };
}

/** Generate a random date within the last DAYS_BACK days, weighted toward recent. */
function randomPastDate(): Date {
  // Use a quadratic distribution so more traces are recent
  const t = Math.random();
  const daysAgo = Math.floor(t * t * DAYS_BACK); // quadratic: clusters near 0 (recent)
  const now = Date.now();
  const ms = now - daysAgo * 86_400_000 - randInt(0, 86_400_000);
  return new Date(ms);
}

function iso(date: Date): string {
  return date.toISOString();
}

/** Advance a date by `ms` milliseconds. */
function advance(date: Date, ms: number): Date {
  return new Date(date.getTime() + ms);
}

// ── Simulation engine ────────────────────────────────────────────────────────

interface SimContext {
  client: IngestClient;
  traceId: string;
  environment: string;
  model: typeof MODELS[number];
  spans: SpanPayload[];
}

function makeSpan(
  ctx: SimContext,
  parentSpanId: string | undefined,
  name: string,
  type: SpanPayload["type"],
  startTime: Date,
  durationMs: number,
  opts?: {
    provider?: string;
    model?: string;
    input?: unknown;
    output?: unknown;
    inputTokens?: number;
    outputTokens?: number;
    status?: "ok" | "error";
    statusMessage?: string;
    metadata?: Record<string, string>;
  },
): { spanId: string; endTime: Date } {
  const spanId = generateSpanId();
  const endTime = advance(startTime, durationMs);

  const span: SpanPayload = {
    id: spanId,
    trace_id: ctx.traceId,
    parent_span_id: parentSpanId,
    name,
    type,
    start_time: iso(startTime),
    end_time: iso(endTime),
    status: opts?.status ?? "ok",
    status_message: opts?.statusMessage,
    input: opts?.input,
    output: opts?.output,
    provider: opts?.provider,
    model: opts?.model,
    input_tokens: opts?.inputTokens,
    output_tokens: opts?.outputTokens,
    metadata: opts?.metadata,
    ...(opts?.inputTokens && opts?.model
      ? computeCost(
          MODELS.find((m) => m.id === opts.model) ?? ctx.model,
          opts.inputTokens,
          opts.outputTokens ?? 0,
        )
      : {}),
  };

  ctx.spans.push(span);
  return { spanId, endTime };
}

function simulateWeatherTool(
  ctx: SimContext,
  parentSpanId: string,
  startTime: Date,
  city: string,
): { endTime: Date; result: Record<string, unknown> } {
  // Retrieval span: API lookup
  const retrievalDur = randInt(80, 400);
  const { endTime: afterRetrieval } = makeSpan(ctx, parentSpanId, "weather-lookup", "retrieval", startTime, retrievalDur, {
    input: { api: "open-meteo", city },
    output: { city, coordinates: { lat: randFloat(-90, 90), lon: randFloat(-180, 180) } },
  });

  // Tool span: process result
  const toolDur = randInt(100, 500);
  const temp = randInt(-10, 42);
  const wind = randInt(0, 50);
  const condition = pick(WEATHER_CONDITIONS);
  const { endTime } = makeSpan(ctx, parentSpanId, "get_weather", "tool", afterRetrieval, toolDur, {
    input: { city },
    output: { city, temperature_c: temp, wind_speed_kmh: wind, condition },
  });

  return { endTime, result: { city, temperature_c: temp, condition } };
}

function simulateWikiTool(
  ctx: SimContext,
  parentSpanId: string,
  startTime: Date,
  topic: string,
): { endTime: Date; result: Record<string, unknown> } {
  // Retrieval span: fetch article
  const retrievalDur = randInt(150, 700);
  const extract = `${topic} is a subject of significant interest. This article covers the key aspects and developments related to ${topic.toLowerCase()}.`;
  const { endTime: afterRetrieval } = makeSpan(ctx, parentSpanId, "wikipedia-fetch", "retrieval", startTime, retrievalDur, {
    input: { api: "wikipedia", topic },
    output: { title: topic, extract_length: randInt(500, 5000) },
  });

  // Nested LLM call to summarize (uses cheap model)
  const summarizeModel = MODELS.find((m) => m.id === "anthropic/claude-3.5-haiku")!;
  const inputTk = randInt(400, 1200);
  const outputTk = randInt(60, 250);
  const summarizeDur = randInt(800, 2500);
  const { endTime } = makeSpan(ctx, parentSpanId, "summarize-article", "llm", afterRetrieval, summarizeDur, {
    provider: summarizeModel.provider,
    model: summarizeModel.id,
    input: { system: "Summarize this Wikipedia article concisely.", article: extract },
    output: { summary: `${topic} is a fascinating area covering several important concepts and developments.` },
    inputTokens: inputTk,
    outputTokens: outputTk,
  });

  return { endTime, result: { title: topic, summary: `Summary of ${topic}` } };
}

function simulateTurn(
  ctx: SimContext,
  turn: Turn,
  turnIndex: number,
  startTime: Date,
  conversationHistory: Array<{ role: string; content: string }>,
): Date {
  const stepName = turnIndex === 0 ? "chat" : `followup-${turnIndex}`;
  const stepSpanId = generateSpanId();
  const stepStart = startTime;

  const messages = [...conversationHistory, { role: "user", content: turn.message }];

  // Token counts grow with conversation history
  const historyTokenBoost = conversationHistory.length * randInt(80, 200);

  let cursor = stepStart;

  if (turn.expectsTools.length > 0) {
    // Step A: LLM plans which tools to call
    const planInputTk = randInt(200, 800) + historyTokenBoost;
    const planOutputTk = randInt(30, 120);
    const planDur = randInt(800, 3000);

    const toolCalls = turn.expectsTools.map((type) => {
      if (type === "weather") return { name: "get_weather", args: { city: pick(CITIES) } };
      return { name: "search_wikipedia", args: { topic: pick(WIKI_TOPICS) } };
    });

    const { endTime: afterPlan } = makeSpan(ctx, stepSpanId, "plan", "llm", cursor, planDur, {
      provider: ctx.model.provider,
      model: ctx.model.id,
      input: { messages, tools: ["get_weather", "search_wikipedia"] },
      output: { tool_calls: toolCalls },
      inputTokens: planInputTk,
      outputTokens: planOutputTk,
    });
    cursor = afterPlan;

    // Step B: Execute tool calls
    const toolResults: Record<string, unknown>[] = [];
    for (const tc of toolCalls) {
      if (tc.name === "get_weather") {
        const { endTime, result } = simulateWeatherTool(ctx, stepSpanId, cursor, tc.args.city!);
        cursor = endTime;
        toolResults.push(result);
      } else {
        const { endTime, result } = simulateWikiTool(ctx, stepSpanId, cursor, tc.args.topic!);
        cursor = endTime;
        toolResults.push(result);
      }
    }

    // Step C: LLM generates final response with tool results
    const respondInputTk = randInt(400, 1200) + historyTokenBoost;
    const respondOutputTk = randInt(80, 500);
    const respondDur = randInt(1000, 5000);

    const assistantContent = `Here's what I found: ${toolResults.map((r) => (r as any).city || (r as any).title).join(", ")}.`;
    const { endTime: afterRespond } = makeSpan(ctx, stepSpanId, "respond", "llm", cursor, respondDur, {
      provider: ctx.model.provider,
      model: ctx.model.id,
      input: { messages, tool_results: toolResults },
      output: { role: "assistant", content: assistantContent },
      inputTokens: respondInputTk,
      outputTokens: respondOutputTk,
    });
    cursor = afterRespond;

    conversationHistory.push(
      { role: "user", content: turn.message },
      { role: "assistant", content: assistantContent },
    );
  } else {
    // No tool calls — straight LLM response
    const inputTk = randInt(150, 600) + historyTokenBoost;
    const outputTk = randInt(50, 400);
    const dur = randInt(800, 4000);

    const assistantContent = "I'd be happy to help with that. Let me know if you have any other questions!";
    const { endTime: afterGenerate } = makeSpan(ctx, stepSpanId, "generate", "llm", cursor, dur, {
      provider: ctx.model.provider,
      model: ctx.model.id,
      input: { messages },
      output: { role: "assistant", content: assistantContent },
      inputTokens: inputTk,
      outputTokens: outputTk,
    });
    cursor = afterGenerate;

    conversationHistory.push(
      { role: "user", content: turn.message },
      { role: "assistant", content: assistantContent },
    );
  }

  // Emit the step span wrapping this turn
  const stepSpan: SpanPayload = {
    id: stepSpanId,
    trace_id: ctx.traceId,
    name: stepName,
    type: "step",
    start_time: iso(stepStart),
    end_time: iso(cursor),
  };
  ctx.spans.push(stepSpan);

  return cursor;
}

function simulateErrorTurn(
  ctx: SimContext,
  turn: Turn,
  turnIndex: number,
  startTime: Date,
  conversationHistory: Array<{ role: string; content: string }>,
): Date {
  const stepSpanId = generateSpanId();
  const historyTokenBoost = conversationHistory.length * randInt(80, 200);
  const inputTk = randInt(200, 600) + historyTokenBoost;
  const dur = randInt(2000, 15000); // errors often take longer (timeouts)

  const errorMessages = [
    "LLM request timed out after 30000ms",
    "Rate limit exceeded, retry after 60s",
    "Context length exceeded: 128000 tokens",
    "Internal server error from provider",
    "Connection reset by peer",
    "Service temporarily unavailable",
    "Invalid response format from provider",
  ];

  const { endTime } = makeSpan(ctx, stepSpanId, "generate", "llm", startTime, dur, {
    provider: ctx.model.provider,
    model: ctx.model.id,
    input: { messages: [...conversationHistory, { role: "user", content: turn.message }] },
    inputTokens: inputTk,
    status: "error",
    statusMessage: pick(errorMessages),
  });

  // Step span also errors
  const stepSpan: SpanPayload = {
    id: stepSpanId,
    trace_id: ctx.traceId,
    name: `turn-${turnIndex}`,
    type: "step",
    start_time: iso(startTime),
    end_time: iso(endTime),
    status: "error",
    statusMessage: "Turn failed",
  };
  ctx.spans.push(stepSpan);

  return endTime;
}

// ── Conversation simulation ─────────────────────────────────────────────────

async function simulateConversation(client: IngestClient, index: number) {
  const traceId = generateTraceId();
  const model = pick(MODELS);
  const userId = pick(USERS);
  const sessionId = `session-${Date.now()}-${index}`;
  const environment = pick(ENVIRONMENTS);
  const traceName = pick(TRACE_NAMES);

  const traceStart = randomPastDate();
  const starter = pick(CONVERSATION_STARTERS);
  const numFollowups = randInt(0, 4); // 0-3 follow-up turns

  const turns: Turn[] = [starter];
  for (let i = 0; i < numFollowups; i++) {
    turns.push(pick(FOLLOWUPS));
  }

  const shouldError = Math.random() < 0.08;
  const errorTurn = shouldError ? randInt(0, turns.length) : -1;

  const ctx: SimContext = { client, traceId, environment, model, spans: [] };
  const conversationHistory: Array<{ role: string; content: string }> = [];
  let cursor = traceStart;
  let traceStatus: "ok" | "error" = "ok";
  let traceStatusMessage: string | undefined;

  for (let t = 0; t < turns.length; t++) {
    if (t === errorTurn) {
      cursor = simulateErrorTurn(ctx, turns[t]!, t, cursor, conversationHistory);
      traceStatus = "error";
      traceStatusMessage = "Conversation failed on turn " + t;
      break;
    }

    cursor = simulateTurn(ctx, turns[t]!, t, cursor, conversationHistory);

    // Gap between turns (user thinking)
    if (t < turns.length - 1) {
      cursor = advance(cursor, randInt(500, 3000));
    }
  }

  const traceEnd = cursor;

  // Send trace start event
  const traceStartPayload: TracePayload = {
    id: traceId,
    name: traceName,
    start_time: iso(traceStart),
    input: { message: starter.message },
    user_id: userId,
    session_id: sessionId,
    environment,
    tags: {
      model: model.id,
      provider: model.provider,
      turns: String(turns.length),
    },
  };
  client.sendTrace(traceStartPayload);

  // Send trace end event
  const traceEndPayload: TracePayload = {
    id: traceId,
    name: traceName,
    start_time: iso(traceStart),
    end_time: iso(traceEnd),
    status: traceStatus,
    status_message: traceStatusMessage,
    input: { message: starter.message },
    output: traceStatus === "ok"
      ? { content: conversationHistory.at(-1)?.content ?? "" }
      : undefined,
    user_id: userId,
    session_id: sessionId,
    environment,
    tags: {
      model: model.id,
      provider: model.provider,
      turns: String(turns.length),
    },
  };
  client.sendTrace(traceEndPayload);

  // Send all spans
  client.sendSpans(ctx.spans);
}

// ── Main ─────────────────────────────────────────────────────────────────────

console.log(`Simulating ${COUNT} conversations (spread across last ${DAYS_BACK} days)...\n`);

const client = new IngestClient({
  apiKey: config.apiKey,
  baseUrl: config.baseUrl,
  flushInterval: 0, // manual flush only
  maxBatchSize: 500,
});

let completed = 0;
let failed = 0;

const BATCH_SIZE = 10;
for (let i = 0; i < COUNT; i += BATCH_SIZE) {
  const batch = Math.min(BATCH_SIZE, COUNT - i);
  for (let j = 0; j < batch; j++) {
    const idx = i + j;
    try {
      await simulateConversation(client, idx);
      completed++;
      process.stdout.write(`  [${completed}/${COUNT}] conversation-${idx + 1} ... ok\n`);
    } catch (err) {
      completed++;
      failed++;
      process.stdout.write(`  [${completed}/${COUNT}] conversation-${idx + 1} ... FAILED\n`);
      console.error(err);
    }
  }

  // Flush after each batch
  await client.flush();
}

// Final flush
await client.flush();
await client.shutdown();

console.log(`\nDone. ${completed - failed}/${completed} conversations traced successfully.`);
if (failed > 0) process.exit(1);
