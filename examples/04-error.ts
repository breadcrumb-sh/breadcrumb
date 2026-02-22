/**
 * 04-error — agent that fails mid-run.
 *
 * The timer is ended manually with status "error", then the error is thrown.
 * The callback form catches the throw and automatically closes the agent
 * with status "error" — no manual agent.end() needed.
 *
 * Run: npm run error --workspace=examples
 */

import { Breadcrumb } from "@breadcrumb/sdk";
import { config, sleep } from "./config.js";

const bc = new Breadcrumb(config);

const prompt = "Write a 10,000 word essay on the history of computing.";

try {
  await bc.agent(
    { name: "failed-generation", input: { prompt } },
    async (agent) => {
      const t = agent.track("claude-completion", "llm", {
        provider: "anthropic",
        model:    "claude-opus-4-6",
        input:    { prompt },
      });

      // Simulate a slow call that exceeds our timeout budget
      await sleep(2100);

      t.end({
        status:        "error",
        statusMessage: "LLM request timed out after 2000ms",
      });

      // Throwing from the callback auto-closes the agent with status: "error"
      throw new Error("LLM request timed out after 2000ms");
    },
  );
} catch {
  // expected — agent is already closed
  console.log("agent closed with error (expected)");
}

await bc.shutdown();
console.log("done");
