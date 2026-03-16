---
name: breadcrumb-tracing
description: Add Breadcrumb LLM tracing to any Node.js/TypeScript project. Use this skill whenever the user wants to add observability, tracing, or monitoring to their LLM application — especially if they mention Breadcrumb, trace LLM calls, track token costs, monitor AI agents, or instrument their Vercel AI SDK usage. Also use when the user says "add tracing", "track my LLM costs", "I want to see what my agent is doing", or asks about observability for AI applications.
---

# Breadcrumb Tracing

Breadcrumb is an LLM observability platform. This skill helps you install and configure the Breadcrumb SDK to trace LLM calls, tool usage, retrieval steps, and agent workflows in any Node.js/TypeScript application.

There are two packages:
- **`@breadcrumb-sdk/core`** — works with any LLM library (Anthropic SDK, OpenAI SDK, custom HTTP calls, etc.)
- **`@breadcrumb-sdk/ai-sdk`** — automatic tracing for the Vercel AI SDK (v5/v6)

You can use either one alone, or both together.

## Installation

```bash
# Core SDK only (works with any LLM library)
npm install @breadcrumb-sdk/core

# If using Vercel AI SDK, add the integration package too
npm install @breadcrumb-sdk/core @breadcrumb-sdk/ai-sdk
```

## Configuration

The SDK needs two things: an **API key** and the **base URL** of the Breadcrumb server.

```typescript
import { init } from "@breadcrumb-sdk/core";

const bc = init({
  apiKey: process.env.BREADCRUMB_API_KEY!,
  baseUrl: process.env.BREADCRUMB_BASE_URL ?? "http://localhost:3100",
  environment: process.env.NODE_ENV, // optional — shown as a filter in the dashboard
});
```

Store the API key in an environment variable, never hardcode it. The user creates API keys in the Breadcrumb dashboard under Project Settings > API Keys.

### Init options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | `string` | required | Project API key (`bc_...`) |
| `baseUrl` | `string` | required | Breadcrumb server URL |
| `environment` | `string` | — | e.g. `"production"`, `"development"` |
| `batching` | `false \| { flushInterval?, maxBatchSize? }` | `{ flushInterval: 5000, maxBatchSize: 100 }` | Set `false` for immediate sends |

## Core SDK Usage (`@breadcrumb-sdk/core`)

Use this when you're calling LLMs directly (Anthropic SDK, OpenAI SDK, fetch, etc.) and want manual control over what gets traced.

### Traces and spans

A **trace** is a top-level unit of work (e.g., one user request). **Spans** are steps within a trace (e.g., an LLM call, a retrieval, a tool execution).

```typescript
const bc = init({ apiKey, baseUrl });

await bc.trace("answer-question", async (root) => {
  // Set trace-level data (input, output, metadata)
  root.set({
    input: [{ role: "user", content: "What is TypeScript?" }],
    metadata: { user_id: "user-123" },
  });

  // Create child spans for each step
  const docs = await bc.span("retrieve-context", async (span) => {
    const results = await vectorDb.search(query);
    span.set({
      input: [{ role: "user", content: query }],
      output: { results },
      metadata: { index: "docs", top_k: "5" },
    });
    return results;
  }, { type: "retrieval" });

  const answer = await bc.span("generate-answer", async (span) => {
    const result = await anthropic.messages.create({ ... });
    span.set({
      input: messages,
      output: result.content[0].text,
      model: "claude-sonnet-4-20250514",
      provider: "anthropic",
      input_tokens: result.usage.input_tokens,
      output_tokens: result.usage.output_tokens,
      input_cost_usd: calculateCost(result.usage, "input"),
      output_cost_usd: calculateCost(result.usage, "output"),
    });
    return result.content[0].text;
  }, { type: "llm" });

  root.set({ output: answer });
});
```

### Span types

The `type` option on `bc.span()` determines how the span appears in the Breadcrumb UI:

| Type | Use for |
|------|---------|
| `"llm"` | LLM API calls (shows model, tokens, cost) |
| `"tool"` | Tool/function executions |
| `"retrieval"` | Vector DB or search queries |
| `"step"` | Logical grouping of sub-steps |

If omitted, the type defaults to `"custom"`.

### Span data (`span.set()`)

Call `span.set()` once per span with any combination of these fields:

| Field | Type | Description |
|-------|------|-------------|
| `input` | `string \| Message[] \| object` | What went into this step. Use `Message[]` for chat-format display. |
| `output` | `string \| object` | What came out of this step |
| `model` | `string` | Model name (e.g., `"claude-sonnet-4-20250514"`, `"gpt-4o"`) |
| `provider` | `string` | Provider name (e.g., `"anthropic"`, `"openai"`) |
| `input_tokens` | `number` | Input token count |
| `output_tokens` | `number` | Output token count |
| `input_cost_usd` | `number` | Input cost in USD |
| `output_cost_usd` | `number` | Output cost in USD |
| `metadata` | `Record<string, string \| number \| boolean>` | Arbitrary key-value pairs for filtering |

The `Message` type is `{ role: "system" | "user" | "assistant" | "tool"; content: string }`.

### Nesting

Spans automatically nest. Any `bc.span()` called inside a `bc.trace()` or another `bc.span()` becomes a child:

```typescript
await bc.trace("agent-run", async () => {
  await bc.span("step-1", async () => {
    await bc.span("sub-step-1a", async (span) => {
      // This becomes a child of step-1
      span.set({ ... });
    }, { type: "llm" });
  }, { type: "step" });
});
```

### Error handling

Errors propagate normally. If a span's callback throws, the span is automatically marked as `status: "error"` with the error message, and the error re-throws so your application's error handling works as expected.

```typescript
await bc.trace("risky-operation", async () => {
  await bc.span("might-fail", async (span) => {
    const result = await somethingThatMightThrow();
    span.set({ output: result });
    return result;
  }, { type: "llm" });
  // If might-fail throws, the trace also gets error status
});
```

## Vercel AI SDK Integration (`@breadcrumb-sdk/ai-sdk`)

If the project uses the Vercel AI SDK (`ai` package), the integration package provides automatic tracing with zero manual span creation for LLM calls.

### Setup

```typescript
import { init } from "@breadcrumb-sdk/core";
import { initAiSdk } from "@breadcrumb-sdk/ai-sdk";

const bc = init({
  apiKey: process.env.BREADCRUMB_API_KEY!,
  baseUrl: process.env.BREADCRUMB_BASE_URL!,
});
const { telemetry } = initAiSdk(bc);
```

### Usage

Pass `telemetry()` to any AI SDK function's `experimental_telemetry` option:

```typescript
import { generateText } from "ai";

const { text } = await generateText({
  model: openai("gpt-4o"),
  prompt: "Explain quantum computing",
  experimental_telemetry: telemetry("explain-quantum"),
});
```

The first argument to `telemetry()` is a function ID (shows as the span name). You can also pass metadata:

```typescript
experimental_telemetry: telemetry("search-agent", {
  user_id: "user-123",
  task: "research",
}),
```

### Wrapping in a trace

Without a `bc.trace()` wrapper, each AI SDK call becomes its own standalone trace. To group multiple calls into one trace, wrap them:

```typescript
await bc.trace("research-workflow", async (root) => {
  root.set({ metadata: { user_id: "user-123" } });

  // Step 1: Plan (fast model)
  const { text: plan } = await generateText({
    model: openai("gpt-4o-mini"),
    prompt: "Break this question into research angles: ...",
    experimental_telemetry: telemetry("plan"),
  });

  // Step 2: Manual retrieval span (no LLM)
  const docs = await bc.span("retrieve", async (span) => {
    const results = await vectorDb.search(plan);
    span.set({ input: plan, output: { results } });
    return results;
  }, { type: "retrieval" });

  // Step 3: Synthesize (smart model)
  const { text: answer } = await generateText({
    model: anthropic("claude-sonnet-4-20250514"),
    prompt: `Context: ${docs.join("\n")}\n\nAnswer: ...`,
    experimental_telemetry: telemetry("synthesize"),
  });

  root.set({ output: answer });
});
```

All three steps appear as children of the "research-workflow" trace. The AI SDK calls automatically capture model, tokens, cost, input, and output — you don't need to call `span.set()` for them.

### Tool calls and agents

AI SDK tool calls are traced automatically, including multi-step agent loops:

```typescript
const { text } = await generateText({
  model: openai("gpt-4o"),
  system: "You are a helpful assistant with tools.",
  prompt: userQuestion,
  tools: {
    search: tool({
      inputSchema: z.object({ query: z.string() }),
      execute: async ({ query }) => searchEngine.query(query),
    }),
    calculator: tool({
      inputSchema: z.object({ expression: z.string() }),
      execute: async ({ expression }) => eval(expression),
    }),
  },
  stopWhen: [stepCountIs(5)],
  experimental_telemetry: telemetry("assistant"),
});
```

Each tool call and LLM reasoning step appears as a separate span in the trace tree.

### Nested subagents

Subagents that make their own AI SDK calls are traced as nested spans:

```typescript
const { text } = await generateText({
  model,
  tools: {
    delegate: tool({
      inputSchema: z.object({ task: z.string() }),
      execute: async ({ task }) => {
        // This subagent's spans appear nested under the parent
        const { text } = await generateText({
          model,
          prompt: task,
          experimental_telemetry: telemetry("sub-agent"),
        });
        return text;
      },
    }),
  },
  experimental_telemetry: telemetry("orchestrator"),
});
```

## Instrumenting an Existing Project

When adding Breadcrumb to an existing codebase, follow this approach:

1. **Install packages** and add env vars (`BREADCRUMB_API_KEY`, `BREADCRUMB_BASE_URL`)

2. **Initialize once** at application startup, before any LLM calls:
   ```typescript
   // lib/breadcrumb.ts (or similar shared module)
   import { init } from "@breadcrumb-sdk/core";
   import { initAiSdk } from "@breadcrumb-sdk/ai-sdk"; // if using AI SDK

   export const bc = init({
     apiKey: process.env.BREADCRUMB_API_KEY!,
     baseUrl: process.env.BREADCRUMB_BASE_URL!,
     environment: process.env.NODE_ENV,
   });

   // Only if using Vercel AI SDK:
   export const { telemetry } = initAiSdk(bc);
   ```

3. **Wrap your entry points** with `bc.trace()`. Each user-facing operation should be one trace:
   ```typescript
   import { bc } from "./lib/breadcrumb";

   async function handleChatMessage(userId: string, message: string) {
     return bc.trace("chat-message", async (root) => {
       root.set({
         input: [{ role: "user", content: message }],
         metadata: { user_id: userId },
       });
       // ... existing logic ...
       root.set({ output: response });
       return response;
     });
   }
   ```

4. **Add spans** around individual LLM calls, tool executions, and retrieval steps within each trace. For AI SDK calls, just add `experimental_telemetry: telemetry("name")`.

5. **Add metadata** for filtering. Common metadata fields: `user_id`, `session_id`, `environment`, `model`, `task_type`.

The SDK is designed to be non-intrusive. Traces and spans are fire-and-forget — if the Breadcrumb server is unreachable, your application continues normally. Failed exports are retried once before being silently dropped.

## Documentation

Full documentation is available at [breadcrumb.sh/docs](https://breadcrumb.sh/docs).
