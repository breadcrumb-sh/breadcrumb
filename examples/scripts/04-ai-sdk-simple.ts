/**
 * 04-ai-sdk-simple — single AI SDK call tracked with @breadcrumb/ai-sdk
 *
 * A single generateText call with telemetry() becomes its own root trace
 * automatically — no bc.trace() wrapping needed.
 * Shows: init(), initAiSdk(), telemetry(), experimental_telemetry
 *
 * Requires: OPENROUTER_API_KEY in examples/.env
 * Run: npm run ai-sdk-simple --workspace=examples
 */

import { init } from "@breadcrumb/sdk";
import { initAiSdk } from "@breadcrumb/ai-sdk";
import { generateText, streamText } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { config, openrouterApiKey } from "../config.js";

if (!openrouterApiKey) {
  console.error("Missing OPENROUTER_API_KEY in examples/.env");
  process.exit(1);
}

// ── Setup ─────────────────────────────────────────────────────────────────────

const bc = init(config);
const { telemetry } = initAiSdk(bc);

const openrouter = createOpenRouter({ apiKey: openrouterApiKey });
const model = openrouter("google/gemini-2.0-flash-001");

// ── Example 1: generateText — single call, becomes its own root trace ─────────

console.log("── generateText ──");

const { text } = await generateText({
  model,
  prompt: "What is the capital of France? Answer in one sentence.",
  experimental_telemetry: telemetry("answer-question", { topic: "geography" }),
});

console.log("answer:", text);

// ── Example 2: streamText — also becomes its own root trace ───────────────────

console.log("\n── streamText ──");

const { textStream } = streamText({
  model,
  prompt: "Explain what TypeScript is in two sentences.",
  experimental_telemetry: telemetry("explain-concept", { concept: "TypeScript" }),
});

process.stdout.write("stream: ");
for await (const chunk of textStream) {
  process.stdout.write(chunk);
}
console.log();
