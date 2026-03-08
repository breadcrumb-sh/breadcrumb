/**
 * 01-sdk-simple — RAG question-answering with @breadcrumb-sdk/core
 *
 * A single user question flows through retrieval and generation. All spans are
 * created manually — no AI SDK required — so this works with any LLM library.
 *
 * Shows: init(), bc.trace(), bc.span(), span.set(), span types, message-format
 *        input, tokens, cost, and metadata.
 *
 * Run: npm run sdk-simple --workspace=examples
 */

import { init } from "@breadcrumb-sdk/core";
import { config, sleep } from "../config.js";

// ── Mock LLM ──────────────────────────────────────────────────────────────────
// Simulates an LLM provider with realistic latency, tokens, and cost.
// Replace with: import Anthropic from "@anthropic-ai/sdk"

interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

interface LlmResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  inputCostUsd: number;
  outputCostUsd: number;
}

async function callLlm(messages: Message[], delayMs = 400): Promise<LlmResult> {
  await sleep(delayMs + Math.random() * 300);
  const totalChars = messages.reduce((n, m) => n + m.content.length, 0);
  const inputTokens = Math.floor(totalChars / 4 + 40);
  const outputTokens = Math.floor(60 + Math.random() * 80);
  return {
    text: "TypeScript brings compile-time type safety, richer IDE tooling, and easier refactoring — especially valuable as codebases grow.",
    inputTokens,
    outputTokens,
    // claude-3-haiku pricing: $0.25 / 1M input, $1.25 / 1M output
    inputCostUsd: (inputTokens / 1_000_000) * 0.25,
    outputCostUsd: (outputTokens / 1_000_000) * 1.25,
  };
}

// ── Script ────────────────────────────────────────────────────────────────────

const bc = init(config);

const question = "What are the main benefits of using TypeScript?";

await bc.trace("simple-qa", async (root) => {
  root.set({
    input: [{ role: "user", content: question }],
    metadata: { user_id: "user-123", session_id: "sess-abc" },
  });

  // Step 1: retrieve relevant documents from a vector store
  const docs = await bc.span("retrieve-context", async (span) => {
    await sleep(80 + Math.random() * 40);
    const results = [
      "TypeScript adds optional static typing to JavaScript.",
      "TypeScript improves IDE tooling, autocompletion, and refactoring.",
      "TypeScript catches type errors at compile time before they reach production.",
      "TypeScript is a superset of JavaScript — existing JS code is valid TS.",
    ];
    span.set({
      input: [{ role: "user", content: question }],
      output: { results },
      metadata: {
        query: question,
        top_k: "4",
        result_count: String(results.length),
        index: "typescript-docs",
      },
    });
    return results;
  }, { type: "retrieval" });

  // Step 2: call the LLM with the retrieved context grounded in the question
  const messages: Message[] = [
    {
      role: "system",
      content:
        "You are a helpful technical assistant. Answer only using the provided context.",
    },
    {
      role: "user",
      content: `Context:\n${docs.map((d, i) => `${i + 1}. ${d}`).join("\n")}\n\nQuestion: ${question}`,
    },
  ];

  const answer = await bc.span("generate-answer", async (span) => {
    const result = await callLlm(messages);
    span.set({
      input: messages,
      output: result.text,
      model: "claude-haiku-4-5",
      provider: "anthropic",
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
      input_cost_usd: result.inputCostUsd,
      output_cost_usd: result.outputCostUsd,
      metadata: {
        finish_reason: "end_turn",
        context_docs: String(docs.length),
      },
    });
    return result.text;
  }, { type: "llm" });

  root.set({
    output: answer,
    metadata: { answer_length: String(answer.length) },
  });

  console.log("answer:", answer);
});
