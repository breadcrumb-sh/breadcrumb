/**
 * 02-pipeline — retrieval-augmented generation (RAG).
 *
 * Two sequential timers: vector search then LLM generation.
 * Run: npm run pipeline --workspace=examples
 */

import { Breadcrumb } from "@breadcrumb/sdk";
import { config, sleep } from "../config.js";

// environment is set once on the constructor, not per trace
const bc = new Breadcrumb({ ...config, environment: "development" });

const query = "What are the main features of TypeScript?";

const answer = await bc.agent(
  { name: "rag-pipeline", input: { query }, userId: "user-demo" },
  async (agent) => {
    // ── 1. Retrieval ───────────────────────────────────────────────────────────

    const retrieval = agent.track("vector-search", "retrieval", {
      input: { query, topK: 3 },
    });

    await sleep(120);

    const docs = [
      "TypeScript adds optional static typing to JavaScript.",
      "TypeScript supports interfaces, generics, enums, and decorators.",
      "TypeScript compiles to plain JavaScript and runs anywhere JS runs.",
    ];

    retrieval.end({ output: { results: docs, count: docs.length } });
    console.log("retrieval done");

    // ── 2. Generation ──────────────────────────────────────────────────────────

    const llm = agent.track("generate-answer", "llm", {
      provider: "anthropic",
      model:    "claude-opus-4-6",
      input:    { system: "Answer concisely using the provided context only.", context: docs, query },
    });

    await sleep(890);

    const text =
      "TypeScript's main features include optional static typing, " +
      "interfaces, generics, enums, and decorator support. " +
      "It compiles to JavaScript and works anywhere JavaScript does.";

    llm.end({
      output:        { content: text },
      inputTokens:   312,
      outputTokens:  58,
      inputCostUsd:  0.000936,
      outputCostUsd: 0.000870,
    });

    console.log("generation done");
    return text;
  },
);

console.log("answer:", answer);

await bc.shutdown();
console.log("done");
