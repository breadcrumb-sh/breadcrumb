import { initAiSdk } from "@breadcrumb-sdk/ai-sdk";
import { init } from "@breadcrumb-sdk/core";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, Output } from "ai";
import z from "zod";
import { config, openrouterApiKey } from "../config";

const bc = init(config);
const { telemetry } = initAiSdk(bc);

const openrouter = createOpenRouter({ apiKey: openrouterApiKey });
const model = openrouter("google/gemini-2.0-flash-001");

const { text } = await generateText({
  model,
  system: "You are a helpful baking assistant.",
  prompt: "Give a recipe for a chocolate cake.",
  experimental_telemetry: telemetry("this-is-a-test", {
    other: "some metadata",
  }),
});
console.log(text);

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
