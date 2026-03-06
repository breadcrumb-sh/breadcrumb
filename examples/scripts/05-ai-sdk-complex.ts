/**
 * 05-ai-sdk-complex — multi-step agent trace with @breadcrumb-sdk/ai-sdk
 *
 * Multiple AI SDK calls grouped under one bc.trace(). OTel context propagation
 * automatically nests each AI SDK span under the active breadcrumb trace.
 * Manual bc.span() calls (retrieval, formatting) sit alongside LLM spans.
 * Shows: bc.trace() + telemetry(), mixed manual/AI SDK spans, multi-turn chat.
 *
 * Requires: OPENROUTER_API_KEY in examples/.env
 * Run: npm run ai-sdk-complex --workspace=examples
 */

import { init } from "@breadcrumb-sdk/core";
import { initAiSdk } from "@breadcrumb-sdk/ai-sdk";
import { generateText } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { config, openrouterApiKey, sleep } from "../config.js";

if (!openrouterApiKey) {
  console.error("Missing OPENROUTER_API_KEY in examples/.env");
  process.exit(1);
}

// ── Setup ─────────────────────────────────────────────────────────────────────

const bc = init(config);
const { telemetry } = initAiSdk(bc);

const openrouter = createOpenRouter({ apiKey: openrouterApiKey });
const fast = openrouter("google/gemini-2.0-flash-001");
const smart = openrouter("anthropic/claude-3.5-haiku");

// ── Example 1: research assistant — plan → retrieve → synthesize ──────────────
//
// All steps appear as children of the "research-assistant" trace.
// AI SDK spans nest automatically via OTel context; bc.span() spans do too.

console.log("── research assistant ──\n");

const query = "What are the practical benefits of TypeScript for large teams?";

await bc.trace("research-assistant", async (root) => {
  root.set({ query, user_id: "demo" });

  // Step 1: plan the research angles (fast model — planning doesn't need much)
  const { text: plan } = await generateText({
    model: fast,
    prompt: `List 3 specific research angles for: "${query}". Be brief, one line each.`,
    experimental_telemetry: telemetry("plan-research", { query }),
  });
  console.log("plan:\n" + plan);

  // Step 2: retrieve documents (manual span — no LLM needed here)
  const docs = await bc.span("retrieve-docs", async (span) => {
    span.set({ query, sources: ["internal-wiki", "github-issues", "stack-overflow"] });
    await sleep(80); // simulate vector DB lookup
    const results = [
      "TypeScript's type system catches 15% of common bugs before runtime.",
      "Teams report 20-30% faster onboarding with typed codebases.",
      "Refactoring confidence increases significantly with static analysis.",
    ];
    span.set({ doc_count: results.length });
    return results;
  }, { type: "retrieval" });

  // Step 3: synthesize a grounded answer (smart model — synthesis needs reasoning)
  const { text: answer } = await generateText({
    model: smart,
    system: "You are a concise technical writer. Use only the provided context.",
    prompt: `Context:\n${docs.map((d, i) => `${i + 1}. ${d}`).join("\n")}\n\nQuestion: ${query}`,
    experimental_telemetry: telemetry("synthesize-answer", { doc_count: docs.length }),
  });

  root.set({ answer_length: answer.length });
  console.log("\nanswer:\n" + answer);
});

// ── Example 2: multi-turn chat — all turns under one trace ────────────────────
//
// Each turn is a separate generateText call, all nested under the same trace.
// The history is passed manually so the model has context.

console.log("\n── multi-turn chat ──\n");

const turns = [
  "What is TypeScript in one sentence?",
  "What's the biggest downside?",
  "Would you recommend it for a 5-person startup?",
];

await bc.trace("chat-session", async (root) => {
  root.set({ user_id: "demo", turns: turns.length });

  const history: { role: "user" | "assistant"; content: string }[] = [];

  for (const [i, message] of turns.entries()) {
    const { text: reply } = await generateText({
      model: fast,
      messages: [
        ...history,
        { role: "user", content: message },
      ],
      experimental_telemetry: telemetry(`turn-${i + 1}`, { message }),
    });

    console.log(`user: ${message}`);
    console.log(`assistant: ${reply}\n`);

    history.push({ role: "user", content: message });
    history.push({ role: "assistant", content: reply });
  }

  root.set({ turns_completed: turns.length });
});
