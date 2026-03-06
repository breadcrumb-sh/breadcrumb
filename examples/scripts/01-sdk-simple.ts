/**
 * 01-sdk-simple — basic nested trace with @breadcrumb-sdk/core
 *
 * A single question-answering request: retrieve context, then generate an answer.
 * Shows: init(), bc.trace(), bc.span(), span.set()
 *
 * Run: npm run sdk-simple --workspace=examples
 */

import { init } from "@breadcrumb-sdk/core";
import { config, sleep } from "../config.js";

// ── Mock LLM ─────────────────────────────────────────────────────────────────
// Simulates an LLM provider call with realistic latency and token counts.
// In production replace this with: import { anthropic } from "@ai-sdk/anthropic"

interface LlmResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

async function callLlm(prompt: string, delayMs = 400): Promise<LlmResult> {
  await sleep(delayMs + Math.random() * 300);
  return {
    text: `Here is a concise answer based on the provided context.`,
    inputTokens: Math.floor(prompt.length / 4 + 40),
    outputTokens: Math.floor(40 + Math.random() * 60),
  };
}

// ── Script ───────────────────────────────────────────────────────────────────

const bc = init(config);

const question = "What are the main benefits of using TypeScript?";

await bc.trace("simple-qa", async (root) => {
  root.set({ input: question });

  // 1. Retrieve relevant documents
  const docs = await bc.span("retrieve-context", async (span) => {
    await sleep(90);
    const results = [
      "TypeScript adds optional static typing to JavaScript.",
      "TypeScript improves IDE tooling, autocompletion, and refactoring.",
      "TypeScript catches type errors at compile time before they reach production.",
    ];
    span.set({ metadata: { query: question, top_k: 3, result_count: results.length } });
    return results;
  }, { type: "retrieval" });

  // 2. Generate an answer grounded in the retrieved docs
  const answer = await bc.span("generate-answer", async (span) => {
    const prompt = `Context:\n${docs.join("\n")}\n\nQuestion: ${question}`;
    const result = await callLlm(prompt);
    span.set({
      input: prompt,
      output: result.text,
      model: "claude-opus-4-6",
      provider: "anthropic",
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
    });
    return result.text;
  }, { type: "llm" });

  root.set({ output: answer });
  console.log("answer:", answer);
});
