# @breadcrumb/ai-sdk — API Redesign Proposals

**Goal**: minimum user code, deep automatic tracking.

---

## Option A — Wrapped Model (recommended)

Wrap the model once at setup. All calls inside `bc.agent()` are tracked automatically — zero per-call code.

```ts
import { withBreadcrumb } from "@breadcrumb/ai-sdk";

const bc = new Breadcrumb(config);
const model = withBreadcrumb(anthropic("claude-opus-4-6"), bc);

// Zero tracking code inside agents
await bc.agent({ name: "chat", input: { query } }, async () => {
  const { text } = await generateText({ model, prompt: query });
  return text;
});
```

**How**: uses AI SDK's `wrapLanguageModel` middleware. On each call the middleware reads `bc.currentAgent()` — if inside a `bc.agent()` context it creates a timer, otherwise no-ops.

**Name override** (optional, for multiple LLM calls in one agent):
```ts
const { text } = await generateText({
  model: withBreadcrumb(model, bc, "respond"),
  prompt,
});
```

---

## Option B — Auto-context spread (minimal change from current)

Keep the spread pattern but read agent from context automatically. Pass `bc` instead of `agent`.

```ts
import { telemetry } from "@breadcrumb/ai-sdk";

await bc.agent({ name: "chat" }, async () => {
  const { text } = await generateText({
    model,
    prompt,
    ...telemetry(bc, "respond"), // reads bc.currentAgent() internally
  });
  return text;
});
```

Vs current which requires the agent param explicitly:
```ts
// current (worse)
async (agent) => {
  ...telemetry(agent, "respond")
}
```

**How**: `telemetry(bc)` calls `bc.currentAgent()` at call time. If no active agent, experimental_telemetry is disabled.

---

## Option C — Global instrument (zero per-call, zero per-model)

One-time setup. Every AI SDK call inside any `bc.agent()` is tracked.

```ts
import { instrument } from "@breadcrumb/ai-sdk";

const bc = new Breadcrumb(config);
instrument(bc); // called once, globally

// Everything is tracked automatically
await bc.agent({ name: "chat" }, async () => {
  const { text } = await generateText({ model, prompt });
  return text;
});
```

**How**: patches the global OTel tracer provider that the AI SDK's `experimental_telemetry` uses. The tracer reads from `bc.currentAgent()` on each span.

**Risk**: global mutation — affects all AI SDK calls in the process, not just ones using `bc`.

---

## Comparison

| | Setup | Per-call code | Name control | Global risk |
|---|---|---|---|---|
| **A — wrapped model** | `withBreadcrumb(model, bc)` | none | optional 3rd arg | none |
| **B — spread w/ bc** | none | `...telemetry(bc)` | 2nd arg | none |
| **C — instrument** | `instrument(bc)` | none | no | yes |

---

## Recommendation

**A + B together**: `withBreadcrumb` as the primary API, `telemetry(bc)` as fallback for cases where wrapping the model isn't practical (e.g. dynamic models, third-party code).

SDK change needed: `Breadcrumb` must expose `currentAgent()` — it already does. The `@breadcrumb/ai-sdk` calls `bc.currentAgent()` internally, removing the need to pass `agent` around.
