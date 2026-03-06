# @breadcrumb/sdk

Trace your AI agents and pipelines with Breadcrumb.

## Install

```bash
npm install @breadcrumb/sdk
```

## Quick start

```ts
import { init } from "@breadcrumb/sdk";

const bc = init({
  apiKey: "bc_...",
  baseUrl: "https://your-breadcrumb-instance.com",
});

const answer = await bc.trace("answer-question", async (root) => {
  root.set({ input: "What is TypeScript?" });

  const docs = await bc.span("retrieve", async (span) => {
    span.set({ metadata: { source: "docs", top_k: 5 } });
    return await fetchDocs(query);
  }, { type: "retrieval" });

  const result = await bc.span("generate", async (span) => {
    const output = await callLlm(docs);
    span.set({
      input: docs.join("\n"),
      output: output.text,
      model: "claude-opus-4-6",
      provider: "anthropic",
      input_tokens: output.inputTokens,
      output_tokens: output.outputTokens,
    });
    return output.text;
  }, { type: "llm" });

  root.set({ output: result });
  return result;
});
```

## API

### `init(options)`

Call once at startup. Returns a `bc` instance you use to create traces and spans.

```ts
const bc = init({
  apiKey: string,
  baseUrl: string,
  batching?: false | {
    flushInterval?: number,  // ms between sends (default: 5000)
    maxBatchSize?: number,   // spans per send (default: 100)
  }
})
```

Set `batching: false` to send each span as it finishes. The default batches them. Either way, everything is flushed before the process exits.

---

### `bc.trace(name, fn)`

Starts a new top-level trace. Everything you call inside `fn` that uses `bc.span()` will be nested under it in the UI.

```ts
await bc.trace("my-agent", async (span) => {
  span.set({ input: userMessage });
  // ... your agent logic
});
```

Always creates a fresh trace — if you call `bc.trace()` inside another `bc.trace()`, you get two separate traces, not a nested one. Use `bc.span()` for nesting.

The span closes automatically when `fn` returns. If `fn` throws, the span is marked as failed and the error is rethrown.

---

### `bc.span(name, fn, options?)`

Adds a step inside the currently running trace. Spans nest automatically — a span inside a span inside a trace shows as a tree in the UI.

If called outside any trace, it starts its own trace.

```ts
const result = await bc.span(
  "classify",
  async (span) => {
    span.set({ model: "gpt-4o", provider: "openai" });
    return await classify(input);
  },
  { type: "llm" }
);
```

**Options:**

| Option | Values |
|--------|--------|
| `type` | `"llm"` `"tool"` `"retrieval"` `"step"` |

---

### `span.set(data)`

Attach data to a span. Call it any time while the span is open.

```ts
span.set({
  input: "What is TypeScript?",        // shown in the UI
  output: "A typed superset of JS.",   // shown in the UI
  model: "claude-opus-4-6",
  provider: "anthropic",
  input_tokens: 312,
  output_tokens: 58,
  input_cost_usd: 0.00093,
  output_cost_usd: 0.00087,
  metadata: {
    score: 0.95,
    environment: "production",
  },
});
```

All fields are optional. `null` and `undefined` are ignored.

| Field | Type | Description |
|-------|------|-------------|
| `input` | `unknown` | Input passed to this step |
| `output` | `unknown` | Output produced by this step |
| `model` | `string` | Model name, e.g. `"gpt-4o"` |
| `provider` | `string` | Provider, e.g. `"openai"` |
| `input_tokens` | `number` | Input token count |
| `output_tokens` | `number` | Output token count |
| `input_cost_usd` | `number` | Input cost in USD |
| `output_cost_usd` | `number` | Output cost in USD |
| `metadata` | `Record<string, string \| number \| boolean>` | Any extra data |
