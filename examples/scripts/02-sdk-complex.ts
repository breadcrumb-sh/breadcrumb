/**
 * 02-sdk-complex — multi-agent research pipeline with @breadcrumb-sdk/core
 *
 * A topic is broken into sub-questions. Sources are fetched in parallel.
 * A coordinator agent delegates analysis to three specialist sub-agents, each
 * running its own nested trace. Results are synthesized into a final report.
 *
 * Shows: nested bc.trace(), parallel bc.span(), sub-agents, mixed span types
 *        (step/retrieval/llm/tool), rich message-format I/O, tokens, costs.
 *
 * Run: npm run sdk-complex --workspace=examples
 */

import { init } from "@breadcrumb-sdk/core";
import { config, sleep } from "../config.js";

// ── Mock infrastructure ────────────────────────────────────────────────────────

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

const PRICING: Record<string, { input: number; output: number }> = {
  "gpt-4o": { input: 2.5, output: 10.0 },
  "claude-opus-4-6": { input: 15.0, output: 75.0 },
  "claude-haiku-4-5": { input: 0.25, output: 1.25 },
};

async function callLlm(
  messages: Message[],
  model = "claude-haiku-4-5",
  delayMs = 250,
): Promise<LlmResult> {
  await sleep(delayMs + Math.random() * 300);
  const chars = messages.reduce((n, m) => n + m.content.length, 0);
  const inputTokens = Math.floor(chars / 4 + 60);
  const outputTokens = Math.floor(100 + Math.random() * 200);
  const price = PRICING[model] ?? PRICING["claude-haiku-4-5"];
  return {
    text: `[${model}] Analysis complete for: "${messages.at(-1)!.content.slice(0, 60).trim()}..."`,
    inputTokens,
    outputTokens,
    inputCostUsd: (inputTokens / 1_000_000) * price.input,
    outputCostUsd: (outputTokens / 1_000_000) * price.output,
  };
}

async function fetchSource(source: string, query: string): Promise<string> {
  await sleep(50 + Math.random() * 100);
  return `[${source}] Relevant findings for "${query.slice(0, 40)}": peer-reviewed content on the topic.`;
}

// ── Script ────────────────────────────────────────────────────────────────────

const bc = init(config);

const topic = "The impact of large language models on software engineering";

await bc.trace("research-pipeline", async (root) => {
  root.set({
    input: [{ role: "user", content: topic }],
    metadata: { user_id: "researcher-1", pipeline_version: "2" },
  });

  // ── Step 1: Coordinator plans the research ─────────────────────────────────
  const subQuestions = await bc.span("plan-research", async (span) => {
    const messages: Message[] = [
      { role: "system", content: "You are a research coordinator. Break complex topics into focused sub-questions." },
      { role: "user", content: `Break this into 3 research sub-questions: ${topic}` },
    ];
    const result = await callLlm(messages, "gpt-4o", 150);
    span.set({
      input: messages,
      output: result.text,
      model: "gpt-4o",
      provider: "openai",
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
      input_cost_usd: result.inputCostUsd,
      output_cost_usd: result.outputCostUsd,
    });
    return [
      "How do LLMs assist with code generation and review?",
      "What are the measured productivity effects on development teams?",
      "What are the key risks and limitations for production use?",
    ];
  }, { type: "step" });

  console.log("planned", subQuestions.length, "research angles");

  // ── Step 2: Fetch sources in parallel for all sub-questions ───────────────
  const allDocs = await bc.span("retrieve-sources", async (span) => {
    const fetches = subQuestions.flatMap((q, i) => [
      bc.span(`fetch-${i}-arxiv`, async (s) => {
        const doc = await fetchSource("arxiv", q);
        s.set({
          input: [{ role: "user", content: q }],
          output: doc,
          metadata: { source: "arxiv", query: q },
        });
        return doc;
      }, { type: "retrieval" }),
      bc.span(`fetch-${i}-semantic-scholar`, async (s) => {
        const doc = await fetchSource("semantic-scholar", q);
        s.set({
          input: [{ role: "user", content: q }],
          output: doc,
          metadata: { source: "semantic-scholar", query: q },
        });
        return doc;
      }, { type: "retrieval" }),
    ]);

    const docs = await Promise.all(fetches);
    span.set({ metadata: { source_count: String(docs.length) } });
    return docs;
  }, { type: "retrieval" });

  console.log("fetched", allDocs.length, "sources");

  // ── Step 3: Three specialist sub-agents analyze in parallel ───────────────
  const analyses = await bc.span("analyze-with-specialists", async (span) => {
    const specialists = [
      { name: "code-gen-specialist", question: subQuestions[0], model: "claude-haiku-4-5" as const },
      { name: "productivity-specialist", question: subQuestions[1], model: "claude-haiku-4-5" as const },
      { name: "risk-specialist", question: subQuestions[2], model: "claude-opus-4-6" as const },
    ];

    const results = await Promise.all(
      specialists.map(({ name, question, model }, i) =>
        // Each specialist runs as a nested trace — appears in the hierarchy
        bc.trace(name, async (agentRoot) => {
          agentRoot.set({
            input: [{ role: "user", content: question }],
            metadata: { specialty: name, model },
          });

          // Retrieve relevant docs for this question
          const docs = allDocs.slice(i * 2, i * 2 + 2);

          // Call a search tool (manual tool span)
          const toolOutput = await bc.span("search-knowledge-base", async (s) => {
            await sleep(30 + Math.random() * 50);
            const results = docs.map((d) => ({ source: "knowledge-base", snippet: d }));
            s.set({
              input: { query: question },
              output: { results },
              metadata: { hits: String(results.length) },
            });
            return results;
          }, { type: "tool" });

          // Analyze with LLM
          const messages: Message[] = [
            { role: "system", content: `You are a specialist in ${name.replace("-specialist", "")}. Analyze concisely.` },
            { role: "user", content: `Question: ${question}\n\nSources:\n${toolOutput.map((r) => r.snippet).join("\n")}` },
          ];
          const result = await callLlm(messages, model, 200);

          const analysis = await bc.span("generate-analysis", async (s) => {
            s.set({
              input: messages,
              output: result.text,
              model,
              provider: model.startsWith("claude") ? "anthropic" : "openai",
              input_tokens: result.inputTokens,
              output_tokens: result.outputTokens,
              input_cost_usd: result.inputCostUsd,
              output_cost_usd: result.outputCostUsd,
            });
            return result.text;
          }, { type: "llm" });

          agentRoot.set({ output: analysis });
          return analysis;
        }),
      ),
    );

    span.set({ metadata: { analyses_count: String(results.length) } });
    return results;
  }, { type: "step" });

  console.log("analyses complete:", analyses.length);

  // ── Step 4: Coordinator synthesizes the final report ───────────────────────
  const report = await bc.span("synthesize-report", async (span) => {
    const messages: Message[] = [
      { role: "system", content: "You are a research coordinator. Synthesize specialist analyses into a coherent report." },
      { role: "user", content: `Topic: ${topic}\n\nAnalyses:\n${analyses.map((a, i) => `${i + 1}. ${a}`).join("\n\n")}\n\nWrite a structured executive summary.` },
    ];
    const result = await callLlm(messages, "claude-opus-4-6", 500);
    span.set({
      input: messages,
      output: result.text,
      model: "claude-opus-4-6",
      provider: "anthropic",
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
      input_cost_usd: result.inputCostUsd,
      output_cost_usd: result.outputCostUsd,
    });
    return result.text;
  }, { type: "llm" });

  // ── Step 5: Validate and format output ────────────────────────────────────
  await bc.span("format-output", async (span) => {
    await sleep(25);
    span.set({
      input: report,
      output: report,
      metadata: { format: "markdown", word_count: String(report.split(" ").length) },
    });
  }, { type: "step" });

  root.set({
    output: report,
    metadata: { report_length: String(report.length) },
  });

  console.log("report:", report.slice(0, 100) + "...");
});
