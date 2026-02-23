/**
 * 03-agent — multi-step agent loop with subagents.
 *
 * Each step is a subagent (a "step" span) containing an LLM timer
 * and a tool timer. Subagents share the parent trace ID.
 *
 * Run: npm run agent --workspace=examples
 */

import { Breadcrumb } from "@breadcrumb/sdk";
import { config, sleep } from "../config.js";

const bc = new Breadcrumb(config);

const task = "What is the weather in Paris and London right now?";

const answer = await bc.agent(
  { name: "weather-agent", input: { task } },
  async (agent) => {
    // ── Step 1: LLM decides to call get_weather for Paris ──────────────────────

    const step1 = agent.subagent({ name: "agent-step-1" });

    const llm1 = step1.track("plan", "llm", {
      provider: "anthropic",
      model:    "claude-opus-4-6",
      input:    { task, tools: ["get_weather"] },
    });
    await sleep(520);
    llm1.end({
      output:        { toolCall: { name: "get_weather", args: { city: "Paris" } } },
      inputTokens:   145,
      outputTokens:  28,
      inputCostUsd:  0.000435,
      outputCostUsd: 0.000420,
    });

    const tool1 = step1.track("get_weather", "tool", { input: { city: "Paris" } });
    await sleep(180);
    tool1.end({ output: { city: "Paris", temperature: 18, conditions: "Partly cloudy" } });

    step1.end();
    console.log("step 1 done");

    // ── Step 2: LLM calls get_weather for London ───────────────────────────────

    const step2 = agent.subagent({ name: "agent-step-2" });

    const llm2 = step2.track("plan", "llm", {
      provider: "anthropic",
      model:    "claude-opus-4-6",
      input:    { previousResults: ["Paris: 18°C, partly cloudy"], tools: ["get_weather"] },
    });
    await sleep(480);
    llm2.end({
      output:        { toolCall: { name: "get_weather", args: { city: "London" } } },
      inputTokens:   198,
      outputTokens:  24,
      inputCostUsd:  0.000594,
      outputCostUsd: 0.000360,
    });

    const tool2 = step2.track("get_weather", "tool", { input: { city: "London" } });
    await sleep(160);
    tool2.end({ output: { city: "London", temperature: 12, conditions: "Overcast" } });

    step2.end();
    console.log("step 2 done");

    // ── Step 3: LLM composes final answer ──────────────────────────────────────

    const step3 = agent.subagent({ name: "agent-step-3" });

    const llm3 = step3.track("respond", "llm", {
      provider: "anthropic",
      model:    "claude-opus-4-6",
      input: {
        task,
        results: ["Paris: 18°C, partly cloudy", "London: 12°C, overcast"],
      },
    });
    await sleep(390);
    const text =
      "In Paris it's currently 18°C and partly cloudy. " +
      "In London it's 12°C and overcast.";
    llm3.end({
      output:        { content: text },
      inputTokens:   244,
      outputTokens:  42,
      inputCostUsd:  0.000732,
      outputCostUsd: 0.000630,
    });

    step3.end();
    console.log("step 3 done");

    return text;
  },
);

console.log("answer:", answer);

await bc.shutdown();
console.log("done");
