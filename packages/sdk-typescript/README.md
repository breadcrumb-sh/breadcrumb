# @breadcrumb-sdk/core

Trace your AI agents and pipelines with Breadcrumb. **[Documentation](https://breadcrumb.sh/docs)**

## Install

```bash
npm install @breadcrumb-sdk/core
```

## Quick start

```ts
import { init } from "@breadcrumb-sdk/core";

const bc = init({
  apiKey: "bc_...",
  baseUrl: "https://your-breadcrumb-instance.com",
  environment: "production",
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
  environment?: string,    // e.g. "production", "staging", "development"
  batching?: false | {
    flushInterval?: number,  // ms between sends (default: 5000)
    maxBatchSize?: number,   // spans per send (default: 100)
  }
})
```

Set `environment` once at init time to attach it to every root trace created by this SDK instance. This powers environment filtering in the Breadcrumb UI.

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
    region: "eu-central-1",
  },
});
```

All fields are optional. `null` and `undefined` are ignored.

For `input`, passing a `Message[]` array renders the conversation with role labels in the UI — the same way AI SDK spans appear:

```ts
import type { Message } from "@breadcrumb-sdk/core";

span.set({
  input: [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "What is TypeScript?" },
  ] satisfies Message[],
  output: "TypeScript is a typed superset of JavaScript.",
});
```

| Field | Type | Description |
|-------|------|-------------|
| `input` | `string \| Message[] \| object` | Input passed to this step |
| `output` | `string \| object` | Output produced by this step |
| `model` | `string` | Model name, e.g. `"gpt-4o"` |
| `provider` | `string` | Provider, e.g. `"openai"` |
| `input_tokens` | `number` | Input token count |
| `output_tokens` | `number` | Output token count |
| `input_cost_usd` | `number` | Input cost in USD |
| `output_cost_usd` | `number` | Output cost in USD |
| `metadata` | `Record<string, string \| number \| boolean>` | Any extra data |

## License

AGPL-3.0 — see [LICENSE](./LICENSE) for details.
