/**
 * 05-ai-sdk — AI SDK integration with @breadcrumb/ai-sdk.
 *
 * traceAgent() creates a trace and sets the ALS context in one call.
 * agent.traceModel() wraps the model — every generateText/streamText call
 * inside is tracked automatically with no extra wiring.
 *
 * subagent.traceModel() continues the same trace inside tool execute()
 * functions via ALS — no explicit passing required.
 *
 * Uses MockLanguageModelV3 from "ai/test" so no real API key is needed.
 * In production, swap the mock for a real model:
 *   import { anthropic } from "@ai-sdk/anthropic";
 *   const raw = anthropic("claude-opus-4-6");
 *
 * Run: npm run ai-sdk --workspace=examples
 */

import { subagent, traceAgent } from "@breadcrumb/ai-sdk";
import { Breadcrumb } from "@breadcrumb/sdk";
import { generateText, streamText, tool } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";
import { config, sleep } from "./config.js";

const bc = new Breadcrumb(config);

// ── Mock models ───────────────────────────────────────────────────────────────
// In production: const raw = anthropic("claude-opus-4-6")

const raw = new MockLanguageModelV3({
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
            inputTokens: {
              total: 18,
              noCache: 18,
              cacheRead: 0,
              cacheWrite: 0,
            },
            outputTokens: { total: 8, text: 8, reasoning: 0 },
          },
        });
        controller.close();
      },
    }),
  })) as any,
});

const toolCallRaw = new MockLanguageModelV3({
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

// ── Example 1: generateText ───────────────────────────────────────────────────

console.log("─── generateText ───");

const question = "What is the capital of France?";

const chatAgent = traceAgent({
  client: bc,
  name: "simple-chat",
  input: { question },
});
const { text: answer } = await generateText({
  model: chatAgent.traceModel(raw),
  prompt: question,
});
chatAgent.end({ output: answer });

console.log("answer:", answer);

// ── Example 2: streamText ─────────────────────────────────────────────────────

console.log("\n─── streamText ───");

const topic = "TypeScript generics";

const streamAgent = traceAgent({
  client: bc,
  name: "stream-chat",
  input: { topic },
});
const { textStream } = streamText({
  model: streamAgent.traceModel(raw),
  prompt: `Explain ${topic} briefly.`,
});

process.stdout.write("stream: ");
for await (const chunk of textStream) {
  process.stdout.write(chunk);
}
console.log();
streamAgent.end();

// ── Example 3: Tool calls ─────────────────────────────────────────────────────
// Tool spans nest automatically under the LLM span.

console.log("\n─── tool calls ───");

const weatherAgent = traceAgent({
  client: bc,
  name: "weather-agent",
  input: { task: "What is the weather in Paris?" },
});

await generateText({
  model: weatherAgent.traceModel(toolCallRaw),
  prompt: "What is the weather in Paris?",
  tools: {
    get_weather: tool({
      description: "Get the weather for a city",
      inputSchema: z.object({ city: z.string() }),
    }),
  },
}).catch(() => {}); // mock returns tool-call only, no final text — ignore

weatherAgent.end();

// ── Example 4: subagent inside tool execute ───────────────────────────────────
// subagent.traceModel() reads the active agent from ALS — set by traceAgent()
// above — so nested LLM calls are automatically part of the same trace.

console.log("\n─── subagent in tool execute ───");

const task = "Summarise the weather in Paris and London";

const multiAgent = traceAgent({
  client: bc,
  name: "multi-step",
  input: { task },
  userId: "user-demo",
});

await generateText({
  model: multiAgent.traceModel(toolCallRaw),
  prompt: task,
  tools: {
    get_weather: tool({
      description: "Get the weather for a city",
      inputSchema: z.object({ city: z.string() }),
      execute: async ({ city }) => {
        // subagent reads the active agent from ALS — no explicit passing needed
        const { text } = await generateText({
          model: subagent.traceModel(raw),
          prompt: `Describe the weather in ${city}`,
        });
        return text;
      },
    }),
  },
}).catch(() => {});

multiAgent.end();

// ── Example 5: RAG pipeline ───────────────────────────────────────────────────
// agent.track() adds manual spans alongside the LLM span in the same trace.

console.log("\n─── RAG pipeline ───");

const ragQuery = "What are the main features of TypeScript?";

const ragAgent = traceAgent({
  client: bc,
  name: "rag-pipeline",
  input: { ragQuery },
  userId: "user-demo",
});

// Retrieval step — manually tracked span
const tSearch = ragAgent.track("vector-search", "retrieval", {
  input: { ragQuery, topK: 3 },
});
await sleep(80);
const docs = [
  "TypeScript adds static typing to JavaScript.",
  "TypeScript supports generics, interfaces, and decorators.",
];
tSearch.end({ output: { docs } });

// Generation step — subagent.traceModel() continues the same trace
const { text: ragAnswer } = await generateText({
  model: subagent.traceModel(raw),
  prompt: `Context:\n${docs.join("\n")}\n\nQuestion: ${ragQuery}`,
});

ragAgent.end({ output: ragAnswer });

console.log("answer:", ragAnswer);

await bc.shutdown();
console.log("\ndone");
