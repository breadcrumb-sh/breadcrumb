# @breadcrumb-sdk/ai-sdk

Trace Vercel AI SDK calls with Breadcrumb. Pass `experimental_telemetry` to any `generateText`, `streamText`, or `generateObject` call and it shows up in your dashboard automatically.

## Install

```bash
npm install @breadcrumb-sdk/core @breadcrumb-sdk/ai-sdk
```

## Quick start

```ts
import { init } from "@breadcrumb-sdk/core";
import { initAiSdk } from "@breadcrumb-sdk/ai-sdk";
import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";

const bc = init({ apiKey: "bc_...", baseUrl: "https://your-breadcrumb-instance.com" });
const { telemetry } = initAiSdk(bc);

const { text } = await generateText({
  model: anthropic("claude-opus-4-6"),
  prompt: "What is TypeScript?",
  experimental_telemetry: telemetry("answer-question"),
});
```

Each call with `telemetry()` shows up as its own trace in the dashboard. No other setup needed.

## Grouping calls into one trace

If you want multiple calls to appear under a single trace, wrap them in `bc.trace()`:

```ts
await bc.trace("chat-request", async () => {
  await generateText({ ..., experimental_telemetry: telemetry("plan") });
  await generateText({ ..., experimental_telemetry: telemetry("respond") });
});
```

You can also mix in manual steps — for example a retrieval step that isn't an LLM call:

```ts
await bc.trace("rag-pipeline", async () => {
  const docs = await bc.span("retrieve", async (span) => {
    span.set({ metadata: { source: "vector-db", top_k: 5 } });
    return await vectorSearch(query);
  }, { type: "retrieval" });

  await generateText({
    model,
    prompt: `Context: ${docs.join("\n")}\n\nQuestion: ${query}`,
    experimental_telemetry: telemetry("generate"),
  });
});
```

## API

### `initAiSdk(bc)`

Takes your `bc` instance and returns the `telemetry` helper. Call once after `init()`.

```ts
const { telemetry } = initAiSdk(bc);
```

---

### `telemetry(functionId, metadata?)`

Returns the config to pass to `experimental_telemetry`.

```ts
experimental_telemetry: telemetry("my-step")
experimental_telemetry: telemetry("my-step", { userId: "u_123", temperature: 0.7 })
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `functionId` | `string` | Name shown in the trace UI |
| `metadata` | `Record<string, string \| number \| boolean \| ...[]>` | Extra data attached to the span |

## Compatibility

Works with AI SDK 5 and AI SDK 6.
