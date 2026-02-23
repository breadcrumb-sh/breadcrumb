/**
 * 05-ai-sdk — AI SDK integration with @breadcrumb/ai-sdk.
 *
 * useAiSdkTracing(bc) binds the client once and returns two helpers:
 *
 *   trace(opts)       — single call, trace auto-created and auto-closed.
 *   traceAgent(opts)  — multi-step agent; use .step() per call, .end() when done.
 *
 * For nested generateText inside a tool execute(), pass the same step config
 * to the inner call — OTEL context propagation detects the nesting and places
 * the inner spans under the outer doGenerate span automatically.
 *
 * Uses MockLanguageModelV3 from "ai/test" so no real API key is needed.
 * In production, swap the mock for a real model:
 *   import { anthropic } from "@ai-sdk/anthropic";
 *   const model = anthropic("claude-opus-4-6");
 *
 * Run: npm run ai-sdk --workspace=examples
 */

import { useAiSdkTracing } from "@breadcrumb/ai-sdk";
import { Breadcrumb } from "@breadcrumb/sdk";
import { generateText, streamText, tool } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";
import { config, sleep } from "../config.js";

const bc = new Breadcrumb(config);

// Bind helpers to the client once — export these from a shared module in real apps.
const { trace, traceAgent } = useAiSdkTracing(bc);

// ── Mock models ───────────────────────────────────────────────────────────────
// In production: const model = anthropic("claude-opus-4-6")

const model = new MockLanguageModelV3({
  provider: "anthropic.messages",
  modelId: "claude-opus-4-6",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  doGenerate: (async ({ prompt }: any) => ({
    content: [{ type: "text", text: `Echo: ${JSON.stringify(prompt)}` }],
    finishReason: "stop",
    warnings: [],
    usage: {
      inputTokens: { total: 24, noCache: 24, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 12, text: 12, reasoning: 0 },
    },
  })) as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  doStream: (async ({ prompt }: any) => ({
    stream: new ReadableStream({
      start(controller: ReadableStreamDefaultController) {
        const text = `Streaming: ${JSON.stringify(prompt)}`;
        controller.enqueue({ type: "stream-start", warnings: [] });
        for (const char of text) {
          controller.enqueue({ type: "text-delta", id: "0", delta: char });
        }
        controller.enqueue({
          type: "finish",
          finishReason: "stop",
          usage: {
            inputTokens: { total: 18, noCache: 18, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 8, text: 8, reasoning: 0 },
          },
        });
        controller.close();
      },
    }),
  })) as any,
});

const toolCallModel = new MockLanguageModelV3({
  provider: "anthropic.messages",
  modelId: "claude-opus-4-6",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  doGenerate: (async () => ({
    content: [
      {
        type: "tool-call",
        toolCallId: "call_1",
        toolName: "get_weather",
        input: JSON.stringify({ city: "Paris" }),
      },
    ],
    finishReason: "tool-calls",
    warnings: [],
    usage: {
      inputTokens: { total: 45, noCache: 45, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 18, text: 0, reasoning: 0 },
    },
  })) as any,
  doStream: undefined as any,
});

// ── Example 1: trace() — single generateText call ────────────────────────────
// Trace is created automatically and closed when the call completes.

console.log("─── trace() + generateText ───");

const question = "What is the capital of France?";

const { text: answer } = await generateText({
  model,
  prompt: question,
  experimental_telemetry: trace({ name: "simple-chat", input: { question }, userId: "demo" }),
});

console.log("answer:", answer);

// ── Example 2: trace() — streamText ──────────────────────────────────────────

console.log("\n─── trace() + streamText ───");

const topic = "TypeScript generics";

const { textStream } = streamText({
  model,
  prompt: `Explain ${topic} briefly.`,
  experimental_telemetry: trace({ name: "stream-chat", input: { topic } }),
});

process.stdout.write("stream: ");
for await (const chunk of textStream) {
  process.stdout.write(chunk);
}
console.log();

// ── Example 3: trace() — tool calls ──────────────────────────────────────────
// Tool spans nest automatically under the LLM span via OTEL context.

console.log("\n─── trace() + tool calls ───");

await generateText({
  model: toolCallModel,
  prompt: "What is the weather in Paris?",
  tools: {
    get_weather: tool({
      description: "Get the weather for a city",
      inputSchema: z.object({ city: z.string() }),
    }),
  },
  experimental_telemetry: trace({ name: "weather-lookup", input: { query: "weather in Paris" } }),
}).catch(() => {}); // mock returns tool-call with no execute — ignore the no-result error

// ── Example 4: traceAgent() — multi-step ─────────────────────────────────────
// Several generateText calls grouped under one agent trace.
// The step config is saved so it can be passed to nested calls inside tool execute().

console.log("\n─── traceAgent() ───");

const task = "Summarise the weather in Paris and London";
const agent = traceAgent({ name: "weather-summary", input: { task }, userId: "demo" });

// Save the step so the nested generateText inside tool execute can reuse the
// same BcTracer — OTEL context propagation then shows the inner call as a
// sub-step under the outer doGenerate span.
const searchStep = agent.step("search");

await generateText({
  model: toolCallModel,
  prompt: task,
  tools: {
    get_weather: tool({
      description: "Get the weather for a city",
      inputSchema: z.object({ city: z.string() }),
      execute: async ({ city }) => {
        const { text } = await generateText({
          model,
          prompt: `Describe the weather in ${city}`,
          // Same step tracer → OTEL context detects the nesting and places
          // this LLM call under the outer doGenerate span in the trace view.
          experimental_telemetry: searchStep,
        });
        return text;
      },
    }),
  },
  experimental_telemetry: searchStep,
}).catch(() => {});

agent.end({ output: "done" });

// ── Example 5: traceAgent() + manual spans ───────────────────────────────────
// agent.track() adds manual spans (e.g. retrieval) alongside LLM spans.

console.log("\n─── traceAgent() + manual spans ───");

const ragQuery = "What are the main features of TypeScript?";
const ragAgent = traceAgent({ name: "rag-pipeline", input: { ragQuery }, userId: "demo" });

// Manual retrieval span
const tSearch = ragAgent.track("vector-search", "retrieval", { input: { ragQuery, topK: 3 } });
await sleep(80);
const docs = [
  "TypeScript adds static typing to JavaScript.",
  "TypeScript supports generics, interfaces, and decorators.",
];
tSearch.end({ output: { docs } });

// Generation step
const { text: ragAnswer } = await generateText({
  model,
  prompt: `Context:\n${docs.join("\n")}\n\nQuestion: ${ragQuery}`,
  experimental_telemetry: ragAgent.step("generate"),
});

ragAgent.end({ output: ragAnswer });
console.log("answer:", ragAnswer);

await bc.shutdown();
console.log("\ndone");
