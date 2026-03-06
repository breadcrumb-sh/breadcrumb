/**
 * 02-sdk-complex — multi-step research pipeline with @breadcrumb-sdk/core
 *
 * Breaks a research query into sub-questions, fetches sources in parallel,
 * analyzes them, and writes a structured report.
 * Shows: nested spans, parallel spans, mixed span types, rich attributes.
 *
 * Run: npm run sdk-complex --workspace=examples
 */

import { init } from "@breadcrumb-sdk/core";
import { config, sleep } from "../config.js";

// ── Mock LLM ─────────────────────────────────────────────────────────────────

interface LlmResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

async function callLlm(
  prompt: string,
  model = "claude-opus-4-6",
  delayMs = 300,
): Promise<LlmResult> {
  await sleep(delayMs + Math.random() * 400);
  return {
    text: `[${model}] Synthesized response for: "${prompt.slice(0, 50).trim()}..."`,
    inputTokens: Math.floor(prompt.length / 4 + 60),
    outputTokens: Math.floor(80 + Math.random() * 120),
  };
}

async function fetchSource(source: string): Promise<string> {
  await sleep(60 + Math.random() * 120);
  return `Content from ${source}: relevant information about the research topic.`;
}

// ── Script ───────────────────────────────────────────────────────────────────

const bc = init(config);

const topic = "The impact of large language models on software engineering";

await bc.trace("research-pipeline", async (root) => {
  root.set({ input: topic, metadata: { user_id: "researcher-1" } });

  // ── Step 1: Decompose the topic into sub-questions ─────────────────────────
  const subQuestions = await bc.span("plan-research", async (span) => {
    const prompt = `Break this topic into 3 research questions: ${topic}`;
    const result = await callLlm(prompt, "gpt-4o", 200);
    span.set({
      input: prompt,
      output: result.text,
      model: "gpt-4o",
      provider: "openai",
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
    });
    return [
      "How do LLMs assist with code generation and review?",
      "What are the productivity effects on development teams?",
      "What are the risks and limitations for production use?",
    ];
  }, { type: "step" });

  console.log("sub-questions:", subQuestions.length);

  // ── Step 2: Fetch sources in parallel for each sub-question ───────────────
  const allDocs = await bc.span("retrieve-sources", async (span) => {
    const fetches = subQuestions.flatMap((q, i) => [
      bc.span(`fetch-source-${i}a`, async (s) => {
        const doc = await fetchSource("arxiv");
        s.set({ metadata: { query: q, source: "arxiv", char_count: doc.length } });
        return doc;
      }, { type: "retrieval" }),

      bc.span(`fetch-source-${i}b`, async (s) => {
        const doc = await fetchSource("semantic-scholar");
        s.set({ metadata: { query: q, source: "semantic-scholar", char_count: doc.length } });
        return doc;
      }, { type: "retrieval" }),
    ]);

    const docs = await Promise.all(fetches);
    span.set({ metadata: { source_count: docs.length, total_chars: docs.reduce((n, d) => n + d.length, 0) } });
    return docs;
  }, { type: "retrieval" });

  console.log("documents fetched:", allDocs.length);

  // ── Step 3: Analyze each sub-question with its sources ────────────────────
  const analyses = await bc.span("analyze-sources", async (span) => {
    const results = await Promise.all(
      subQuestions.map((q, i) =>
        bc.span(`analyze-${i}`, async (s) => {
          const prompt = `Question: ${q}\nSources: ${allDocs[i * 2]}\nProvide a brief analysis.`;
          const result = await callLlm(prompt, "claude-opus-4-6", 250);
          s.set({
            input: prompt,
            output: result.text,
            model: "claude-opus-4-6",
            provider: "anthropic",
            input_tokens: result.inputTokens,
            output_tokens: result.outputTokens,
            metadata: { question: q },
          });
          return result.text;
        }, { type: "llm" }),
      ),
    );
    span.set({ metadata: { analyses_count: results.length } });
    return results;
  }, { type: "step" });

  // ── Step 4: Synthesize a final report ─────────────────────────────────────
  const report = await bc.span("generate-report", async (span) => {
    const prompt = `Topic: ${topic}\nAnalyses:\n${analyses.join("\n\n")}\nWrite a structured report.`;
    const result = await callLlm(prompt, "claude-opus-4-6", 600);
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

  // ── Step 5: Format and validate output ────────────────────────────────────
  await bc.span("format-output", async (span) => {
    await sleep(30);
    span.set({ metadata: { report_length: report.length, format: "markdown" } });
  }, { type: "step" });

  root.set({ output: report.slice(0, 200), metadata: { report_length: report.length } });
  console.log("report generated:", report.slice(0, 80) + "...");
});
