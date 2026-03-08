/**
 * 05-ai-sdk-complex — full-featured AI SDK trace with @breadcrumb-sdk/ai-sdk
 *
 * Three examples in one trace session:
 *   1. Research assistant: plan (fast model) → manual retrieval span → synthesize (smart model)
 *   2. Coding agent with tool use: reads files, runs tests, proposes a fix
 *   3. Multi-turn chat: three turns nested under one trace, history maintained manually
 *
 * Shows: bc.trace() + telemetry(), tool calls, nested subagents with their own
 *        telemetry, structured output, manual bc.span() mixed with AI SDK spans,
 *        multi-turn conversation history.
 *
 * Requires: OPENROUTER_API_KEY in examples/.env
 * Run: npm run ai-sdk-complex --workspace=examples
 */

import { init } from "@breadcrumb-sdk/core";
import { initAiSdk } from "@breadcrumb-sdk/ai-sdk";
import { generateText, Output, stepCountIs, tool } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import z from "zod";
import { config, openrouterApiKey, sleep } from "../config.js";

if (!openrouterApiKey) {
  console.error("Missing OPENROUTER_API_KEY in examples/.env");
  process.exit(1);
}

const bc = init(config);
const { telemetry } = initAiSdk(bc);

const openrouter = createOpenRouter({ apiKey: openrouterApiKey });
const fast = openrouter("google/gemini-2.0-flash-001");
const smart = openrouter("anthropic/claude-3.5-haiku");

// ── Example 1: Research assistant — plan → retrieve → synthesize ──────────────
//
// A fast model plans, a manual bc.span() retrieves docs, a smart model
// synthesizes. All appear under one "research-assistant" trace node.

console.log("── research assistant ──\n");

const query = "What are the practical benefits of TypeScript for large engineering teams?";

await bc.trace("research-assistant", async (root) => {
  root.set({ metadata: { user_id: "demo", query } });

  // Fast model breaks the query into research angles
  const { text: plan } = await generateText({
    model: fast,
    prompt: `List 3 specific research angles for this question. Be brief, one line each.\n\nQuestion: ${query}`,
    experimental_telemetry: telemetry("plan-research", { query }),
  });
  console.log("plan:\n" + plan + "\n");

  // Manual retrieval span — no LLM needed for a vector DB lookup
  const docs = await bc.span("retrieve-docs", async (span) => {
    await sleep(80 + Math.random() * 40);
    const results = [
      "TypeScript's type system catches 15% of common runtime bugs before deployment.",
      "Teams report 20–30% faster onboarding with strongly-typed codebases.",
      "Refactoring confidence increases significantly with static analysis and IDE support.",
      "Cross-team API contracts are easier to maintain with shared TypeScript interfaces.",
    ];
    span.set({
      input: [{ role: "user", content: query }],
      output: { results },
      metadata: { index: "internal-wiki", top_k: "4", result_count: String(results.length) },
    });
    return results;
  }, { type: "retrieval" });

  // Smart model synthesizes a grounded answer
  const { text: answer } = await generateText({
    model: smart,
    system: "You are a concise technical writer. Use only the provided context. Be specific.",
    prompt: `Context:\n${docs.map((d, i) => `${i + 1}. ${d}`).join("\n")}\n\nQuestion: ${query}`,
    experimental_telemetry: telemetry("synthesize-answer", { doc_count: docs.length }),
  });

  root.set({ metadata: { answer_length: String(answer.length) } });
  console.log("answer:\n" + answer + "\n");
});

// ── Example 2: Coding agent with tool use ─────────────────────────────────────
//
// The agent uses tools to read files and run tests, then proposes a fix.
// Each tool call becomes a "tool" span in the trace, and a subagent is spawned
// to write the fix — appearing as a nested span.

console.log("── coding agent ──\n");

await bc.trace("coding-agent", async (root) => {
  root.set({ metadata: { task: "fix-bug", repo: "my-app" } });

  const { text: fixPlan } = await generateText({
    model: smart,
    system: "You are a senior software engineer. Use your tools to investigate and fix bugs. Be concise.",
    prompt: "We have a failing test in our authentication module. The test 'should refresh token on expiry' is failing. Please investigate and propose a fix.",
    stopWhen: [stepCountIs(5)],
    tools: {
      readFile: tool({
        description: "Read a file from the repository",
        inputSchema: z.object({ path: z.string() }),
        execute: async ({ path }) => {
          await sleep(30 + Math.random() * 20);
          if (path.includes("auth")) {
            return `// auth.ts\nexport function refreshToken(token: string): string {\n  if (isExpired(token)) {\n    // BUG: returns old token instead of new one\n    return token;\n  }\n  return generateNewToken(token);\n}`;
          }
          return `// ${path}\n// File contents...`;
        },
      }),
      runTests: tool({
        description: "Run the test suite and return results",
        inputSchema: z.object({ filter: z.string().optional() }),
        execute: async ({ filter }) => {
          await sleep(200 + Math.random() * 100);
          return {
            passed: 42,
            failed: 1,
            failures: [
              {
                test: "should refresh token on expiry",
                error: "Expected new token, received old expired token",
                file: "src/auth.test.ts:88",
              },
            ],
            filter: filter ?? "all",
          };
        },
      }),
      writeSubagentFix: tool({
        description: "Spawn a subagent to write the actual code fix",
        inputSchema: z.object({ bugDescription: z.string(), filePath: z.string() }),
        execute: async ({ bugDescription, filePath }) => {
          const { text: fix } = await generateText({
            model: fast,
            system: "You are a code generator. Write only the corrected code, no explanation.",
            prompt: `Fix this bug in ${filePath}:\n${bugDescription}`,
            experimental_telemetry: telemetry("write-fix-subagent", { filePath }),
          });
          return { fix, filePath };
        },
      }),
    },
    experimental_telemetry: telemetry("investigate-bug", { task: "token-refresh" }),
  });

  root.set({ output: fixPlan, metadata: { fix_proposed: "true" } });
  console.log("fix plan:\n" + fixPlan + "\n");
});

// ── Example 3: Multi-turn chat with structured output on final turn ────────────
//
// Three conversational turns, all nested under "chat-session". The final turn
// produces a structured summary using Output.object.

console.log("── multi-turn chat ──\n");

const turns = [
  "What is TypeScript in one sentence?",
  "What's the biggest real-world downside teams run into?",
  "Would you recommend it for a 5-person startup moving fast?",
];

await bc.trace("chat-session", async (root) => {
  root.set({ metadata: { user_id: "demo", turns: String(turns.length) } });

  const history: { role: "user" | "assistant"; content: string }[] = [];

  for (const [i, message] of turns.entries()) {
    const isLastTurn = i === turns.length - 1;

    if (!isLastTurn) {
      // Regular text turns
      const { text: reply } = await generateText({
        model: fast,
        messages: [...history, { role: "user", content: message }],
        experimental_telemetry: telemetry(`turn-${i + 1}`, { turn: i + 1 }),
      });
      console.log(`user: ${message}`);
      console.log(`assistant: ${reply}\n`);
      history.push({ role: "user", content: message });
      history.push({ role: "assistant", content: reply });
    } else {
      // Final turn: produce a structured recommendation object
      const { output: recommendation } = await generateText({
        model: fast,
        output: Output.object({
          schema: z.object({
            verdict: z.enum(["yes", "no", "maybe"]),
            reasons: z.array(z.string()),
            caveats: z.array(z.string()),
          }),
        }),
        messages: [
          ...history,
          { role: "user", content: message + " Please give a structured answer." },
        ],
        experimental_telemetry: telemetry(`turn-${i + 1}`, { turn: i + 1, structured: true }),
      });
      console.log(`user: ${message}`);
      console.log("structured recommendation:", JSON.stringify(recommendation, null, 2));
    }
  }

  root.set({ metadata: { turns_completed: String(turns.length) } });
});
