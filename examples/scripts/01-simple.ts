/**
 * 01-simple — one agent, one LLM timer.
 *
 * The simplest possible usage: ask a question, get an answer.
 * Run: npm run simple --workspace=examples
 */

import { Breadcrumb } from "@breadcrumb/sdk";
import { config, sleep } from "../config.js";

const bc = new Breadcrumb(config);

const question = "What is the capital of France?";

const answer = await bc.agent(
  { name: "simple-chat", input: { messages: [{ role: "user", content: question }] } },
  async (agent) => {
    const t = agent.track("claude-completion", "llm", {
      provider: "anthropic",
      model:    "claude-opus-4-6",
      input:    { messages: [{ role: "user", content: question }] },
    });

    // Simulate the LLM call
    await sleep(450);

    const text = "The capital of France is Paris.";

    t.end({
      output:        { role: "assistant", content: text },
      inputTokens:   22,
      outputTokens:  10,
      inputCostUsd:  0.000066,
      outputCostUsd: 0.000150,
    });

    return text;
  },
);

console.log("answer:", answer);

await bc.shutdown();
console.log("done");
