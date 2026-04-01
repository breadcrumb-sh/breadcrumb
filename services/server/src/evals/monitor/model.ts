/**
 * Shared eval model setup — used by both eval tasks and LLM judge scorers.
 */

import { createOpenAI } from "@ai-sdk/openai";

const openrouter = createOpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

export const evalModel = openrouter.chat(process.env.EVAL_MODEL ?? "anthropic/claude-haiku-4.5");
