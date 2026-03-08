/**
 * 04-ai-sdk-simple — AI SDK traces with @breadcrumb-sdk/ai-sdk
 *
 * A single bc.trace() wrapping multiple AI SDK calls:
 *   1. Plain text generation
 *   2. Structured object output
 *   3. Single-step tool call (weather)
 *   4. Nested subagent with its own telemetry span
 *
 * Shows: init(), initAiSdk(), bc.trace(), telemetry(), Output.object,
 *        tools, stopWhen, nested agent tracing
 *
 * Requires: OPENROUTER_API_KEY in examples/.env
 * Run: npm run ai-sdk-simple --workspace=examples
 */

import { initAiSdk } from "@breadcrumb-sdk/ai-sdk";
import { init } from "@breadcrumb-sdk/core";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, Output, stepCountIs, tool } from "ai";
import z from "zod";
import { config, openrouterApiKey } from "../config.js";

if (!openrouterApiKey) {
  console.error("Missing OPENROUTER_API_KEY in examples/.env");
  process.exit(1);
}

const bc = init(config);
const { telemetry } = initAiSdk(bc);

const openrouter = createOpenRouter({ apiKey: openrouterApiKey });
const model = openrouter("google/gemini-2.0-flash-001");

await bc.trace("full-trace", async () => {
  // ── 1. Plain text generation ───────────────────────────────────────────────
  const { text } = await generateText({
    model,
    system: "You are a helpful baking assistant.",
    prompt: "Give a recipe for a chocolate cake.",
    experimental_telemetry: telemetry("this-is-a-test", {
      other: "some metadata",
    }),
  });
  console.log(text);

  // ── 2. Structured object output ────────────────────────────────────────────
  const { output } = await generateText({
    model,
    output: Output.object({
      schema: z.object({
        name: z.string(),
        ingredients: z.array(z.string()),
        instructions: z.array(z.string()),
      }),
    }),
    system: "You are a helpful baking assistant.",
    prompt: "Give a recipe for a chocolate cake.",
    experimental_telemetry: telemetry("this-is-a-test-object", {
      other: "some metadata",
    }),
  });
  console.log(output);

  // ── 3. Tool call — weather lookup ──────────────────────────────────────────
  const { text: weatherText } = await generateText({
    model,
    system: "You are a weather assistant.",
    prompt: "What's the weather like in Berlin today?",
    stopWhen: [stepCountIs(2)],
    tools: {
      getWeather: tool({
        inputSchema: z.object({
          location: z.string(),
        }),
        execute: () => {
          return {
            location: "Berlin",
            temperature: "20°C",
            condition: "Sunny",
          };
        },
      }),
    },
    experimental_telemetry: telemetry("weather-agent"),
  });
  console.log(weatherText);

  // ── 4. Nested subagent — researcher delegates to a sub-agent ──────────────
  const { text: retrieverText } = await generateText({
    model,
    system:
      "You are a researcher agent. Use your tools to do research and answer the question.",
    prompt:
      "What's the latest research on quantum computing? Please search for that online and summarize the findings.",
    stopWhen: [stepCountIs(10)],
    tools: {
      expertSubagent: tool({
        inputSchema: z.object({
          question: z.string(),
        }),
        execute: async ({ question }) => {
          const { text: subagentText } = await generateText({
            model,
            system:
              "You are a research assistant with the ability to search the web. Use the webSearch tool to find relevant information and answer the question. Do not ask followup questions and try to answer the question as best as you can.",
            prompt: question,
            stopWhen: [stepCountIs(2)],
            experimental_telemetry: telemetry("sub-agent"),
            tools: {
              webSearch: tool({
                inputSchema: z.object({
                  query: z.string(),
                }),
                execute: async () => {
                  return {
                    results: [
                      {
                        title: "New Quantum Algorithm Discovered",
                        link: "https://example.com/quantum-algorithm",
                        snippet:
                          "Researchers have discovered a new quantum algorithm that promises to revolutionize computing.",
                      },
                      {
                        title: "Quantum Computing Breakthrough",
                        link: "https://example.com/quantum-breakthrough",
                        snippet:
                          "A recent breakthrough in quantum computing has brought us closer to practical quantum computers.",
                      },
                    ],
                  };
                },
              }),
            },
          });
          return subagentText;
        },
      }),
    },
    experimental_telemetry: telemetry("researcher-agent"),
  });
  console.log(retrieverText);
});
