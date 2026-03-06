/**
 * 01-simple — one agent, one LLM timer.
 *
 * The simplest possible usage: ask a question, get an answer.
 * Run: npm run simple --workspace=examples
 */

import { initAiSdk } from "@breadcrumb/ai-sdk";
import { init } from "@breadcrumb/sdk";
import { generateText } from "ai";

const bc = init({ apiKey: "", baseUrl: "" });
const { telemetry } = initAiSdk(bc);

bc.trace("test", async (span) => {});

bc.span("", async () => {}, { type: "step" });

generateText({
  model: "",
  messages: [],
  experimental_telemetry: telemetry("some-text-generation"),
});
