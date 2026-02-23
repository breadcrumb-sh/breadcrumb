import { AsyncLocalStorage } from "node:async_hooks";
import { context as otelCtx, trace } from "@opentelemetry/api";
import type { Context, Span, SpanOptions, Tracer } from "@opentelemetry/api";
import { generateSpanId, generateTraceId } from "@breadcrumb/core";

// Module-level ALS mirrors the active BcSpan across async boundaries.
// otelCtx.with() only propagates synchronously; streaming pipelines break out
// of that scope before tool execute() callbacks fire. ALS propagates through
// all async operations (Promises, timers, stream callbacks) automatically.
const _spanAls = new AsyncLocalStorage<BcSpan>();

// ── Duck-typed Breadcrumb interfaces ──────────────────────────────────────────
// No hard dep on @breadcrumb/sdk — structural typing handles it.

type BcSpanType = "llm" | "tool" | "retrieval" | "step" | "custom";

interface BcTimerLike {
  track(
    name: string,
    type: BcSpanType,
    opts?: { input?: unknown; model?: string; provider?: string },
  ): BcTimerLike;
  end(opts?: {
    output?: unknown;
    status?: string;
    statusMessage?: string;
    model?: string;
    provider?: string;
    inputTokens?: number;
    outputTokens?: number;
  }): unknown;
}

interface BcAgentLike {
  track(
    name: string,
    type: BcSpanType,
    opts?: { input?: unknown; model?: string; provider?: string },
  ): BcTimerLike;
  end(opts?: { output?: unknown; status?: string; statusMessage?: string }): void;
}

/** Any object with an `agent()` factory — satisfied by `Breadcrumb`. */
interface BcClient {
  agent(opts: {
    name: string;
    input?: unknown;
    userId?: string;
    sessionId?: string;
    id?: string;
    metadata?: Record<string, string>;
  }): BcAgentLike;
}

// ── BcSpan ────────────────────────────────────────────────────────────────────
// Minimal OTEL Span that collects attributes and fires a callback on end().

class BcSpan {
  readonly #name: string;
  readonly #ctx: {
    traceId: string;
    spanId: string;
    traceFlags: number;
    isRemote: boolean;
  };
  readonly #attrs = new Map<string, unknown>();
  readonly #onEnd: (span: BcSpan) => void;
  #status: { code: number; message?: string } = { code: 0 };

  constructor(name: string, traceId: string, onEnd: (s: BcSpan) => void) {
    this.#name = name;
    this.#ctx = { traceId, spanId: generateSpanId(), traceFlags: 1, isRemote: false };
    this.#onEnd = onEnd;
  }

  // ── OTEL Span interface ──────────────────────────────────────────────────

  spanContext() {
    return this.#ctx;
  }
  setAttribute(key: string, value: unknown) {
    this.#attrs.set(key, value);
    return this;
  }
  setAttributes(attrs: Record<string, unknown>) {
    for (const [k, v] of Object.entries(attrs)) this.#attrs.set(k, v);
    return this;
  }
  setStatus(status: { code: number; message?: string }) {
    this.#status = status;
    return this;
  }
  addEvent() {
    return this;
  }
  addLink() {
    return this;
  }
  recordException() {}
  updateName() {
    return this;
  }
  isRecording() {
    return true;
  }
  end() {
    this.#onEnd(this);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  get spanName() {
    return this.#name;
  }
  /** True when the AI SDK has called setStatus({ code: SpanStatusCode.ERROR }). */
  get isError() {
    return this.#status.code === 2;
  }
  get errorMessage() {
    return this.#status.message;
  }
  attr(key: string) {
    return this.#attrs.get(key);
  }
}

// ── BcTracer ──────────────────────────────────────────────────────────────────
// Custom OTEL Tracer that maps AI SDK span events to Breadcrumb agent/timer calls.

type BcRoot = BcAgentLike | BcTimerLike;

class BcTracer {
  readonly #root: BcRoot;
  readonly #closeRoot: boolean;
  readonly #traceId = generateTraceId();
  // Maps each BcSpan → the Breadcrumb tracker responsible for it
  readonly #spanMap = new WeakMap<BcSpan, BcRoot>();
  // Root spans that are nested (ai.generateText inside a tool execute)
  readonly #nestedRoots = new WeakSet<BcSpan>();
  // functionId from ai.generateText/streamText — forwarded to the LLM span name
  readonly #functionIds = new WeakMap<BcSpan, string>();
  // The first non-nested root span — only this one may close the root tracker.
  // Prevents inner generateText calls (whose OTEL context didn't propagate through
  // a streaming pipeline) from prematurely closing the step timer.
  #topRootSpan: BcSpan | null = null;

  /**
   * @param root    The Breadcrumb agent or step-timer this tracer writes to.
   * @param closeRoot  When true, `root.end()` is called when the top-level
   *                   OTEL root span ends. Set false when the caller manages
   *                   the root lifecycle manually.
   */
  constructor(root: BcRoot, closeRoot: boolean) {
    this.#root = root;
    this.#closeRoot = closeRoot;
  }

  startSpan(name: string, options?: SpanOptions, ctx?: Context): BcSpan {
    const startAttrs = (options?.attributes ?? {}) as Record<string, unknown>;

    // Resolve the parent BcSpan: prefer the OTEL context (set synchronously by
    // startActiveSpan), fall back to ALS (propagates through async boundaries
    // like streaming tool execute() callbacks where otelCtx is stale).
    const parentOtelSpan = ctx ? trace.getSpan(ctx) : undefined;
    const parentBcSpan =
      (parentOtelSpan instanceof BcSpan ? parentOtelSpan : undefined) ??
      _spanAls.getStore();
    const parentTracker: BcRoot =
      (parentBcSpan ? this.#spanMap.get(parentBcSpan) : undefined) ??
      this.#root;

    const span = new BcSpan(name, this.#traceId, (s) => this.#handleEnd(s));

    if (name === "ai.generateText" || name === "ai.streamText") {
      const functionId = startAttrs["ai.telemetry.functionId"] as string | undefined;
      if (functionId) this.#functionIds.set(span, functionId);

      if (parentBcSpan !== undefined) {
        // This generateText was called inside a tool execute — nest it as a step
        // so it appears under the outer doGenerate span in the trace view.
        const timer = parentTracker.track(functionId ?? "nested-llm", "step");
        this.#spanMap.set(span, timer);
        this.#nestedRoots.add(span);
      } else {
        // Top-level call — maps directly to the root agent / step-timer.
        // Record the first one so subsequent top-level spans (inner generateText
        // calls whose context didn't propagate through a stream) don't close root.
        if (!this.#topRootSpan) this.#topRootSpan = span;
        this.#spanMap.set(span, this.#root);
      }
    } else if (
      name === "ai.generateText.doGenerate" ||
      name === "ai.streamText.doStream"
    ) {
      // Provider call — create an LLM span timer under the parent.
      // Prefer functionId from the wrapper span (human-readable) over modelId.
      const functionId = parentBcSpan ? this.#functionIds.get(parentBcSpan) : undefined;
      const modelId = startAttrs["ai.model.id"] as string | undefined;
      const provider = trimProvider(
        startAttrs["ai.model.provider"] as string | undefined,
      );
      const timer = parentTracker.track(functionId ?? modelId ?? "llm", "llm", {
        model: modelId,
        provider,
      });
      this.#spanMap.set(span, timer);
    } else if (name === "ai.toolCall") {
      // Tool invocation — create a tool span nested under the LLM span.
      const toolName =
        (startAttrs["ai.toolCall.name"] as string | undefined) ?? "tool";
      const toolInput = tryParse(startAttrs["ai.toolCall.args"] as string | undefined);
      const timer = parentTracker.track(toolName, "tool", {
        input: toolInput,
      });
      this.#spanMap.set(span, timer);
    }
    // Other AI SDK spans (e.g. ai.embed) are ignored for now.

    return span;
  }

  // Handle all three startActiveSpan overloads in one method.
  startActiveSpan(name: string, ...args: unknown[]): unknown {
    const fn = args[args.length - 1] as (span: Span) => unknown;
    const opts =
      args.length >= 2 &&
      typeof args[0] === "object" &&
      args[0] !== null
        ? (args[0] as SpanOptions)
        : undefined;
    const ctx =
      args.length >= 3 &&
      typeof args[1] === "object" &&
      args[1] !== null
        ? (args[1] as Context)
        : otelCtx.active();

    const span = this.startSpan(name, opts, ctx);
    // Activate the span in both OTEL context (for synchronous nesting) and ALS
    // (so async operations like streaming tool callbacks inherit the parent).
    const newCtx = trace.setSpan(ctx, span as unknown as Span);
    return otelCtx.with(newCtx, () =>
      _spanAls.run(span, fn, span as unknown as Span),
    );
  }

  #handleEnd(span: BcSpan): void {
    const name = span.spanName;
    const tracker = this.#spanMap.get(span);
    if (!tracker) return;

    if (name === "ai.generateText" || name === "ai.streamText") {
      const endOpts = {
        output: span.attr("ai.response.text") as string | undefined,
        status: span.isError ? ("error" as const) : ("ok" as const),
        statusMessage: span.errorMessage,
      };

      if (this.#nestedRoots.has(span)) {
        // Nested — close only the step timer, not the root.
        (tracker as BcTimerLike).end(endOpts);
      } else if (this.#closeRoot && span === this.#topRootSpan) {
        // Only the first non-nested root span closes the root tracker.
        // Subsequent top-level spans are inner calls whose OTEL context didn't
        // propagate through the streaming pipeline — they must not close the root.
        (tracker as BcAgentLike).end(endOpts);
      }
    } else if (
      name === "ai.generateText.doGenerate" ||
      name === "ai.streamText.doStream"
    ) {
      // doGenerate uses the deprecated promptTokens/completionTokens keys;
      // doStream uses the new inputTokens/outputTokens keys — fall back accordingly.
      const inputTokens =
        (span.attr("ai.usage.inputTokens") ?? span.attr("ai.usage.promptTokens")) as number | undefined;
      const outputTokens =
        (span.attr("ai.usage.outputTokens") ?? span.attr("ai.usage.completionTokens")) as number | undefined;

      // Extract cost from providerMetadata if the provider includes it
      // (e.g. OpenRouter with `usage: { include: true }`).
      const cost = extractProviderCost(
        span.attr("ai.response.providerMetadata") as string | undefined,
        inputTokens,
        outputTokens,
      );

      (tracker as BcTimerLike).end({
        model: span.attr("ai.model.id") as string | undefined,
        provider: trimProvider(span.attr("ai.model.provider") as string | undefined),
        inputTokens,
        outputTokens,
        ...cost,
        output: span.attr("ai.response.text") as string | undefined,
        status: span.isError ? ("error" as const) : ("ok" as const),
        statusMessage: span.errorMessage,
      });
    } else if (name === "ai.toolCall") {
      (tracker as BcTimerLike).end({
        // input was already set at track() time from startAttrs["ai.toolCall.args"]
        output: tryParse(span.attr("ai.toolCall.result") as string | undefined),
        status: span.isError ? ("error" as const) : ("ok" as const),
        statusMessage: span.errorMessage,
      });
    }
  }
}

function trimProvider(raw: string | undefined): string | undefined {
  return raw?.split(".")[0];
}

/**
 * Attempt to extract a provider-supplied cost from the `ai.response.providerMetadata`
 * span attribute. If found, the total cost is split proportionally between input and
 * output tokens. Returns an empty object when no cost is available.
 *
 * Currently supports:
 *   - OpenRouter: `{ openrouter: { usage: { cost: number } } }`
 *     (requires `usage: { include: true }` on the model config)
 */
function extractProviderCost(
  metadataJson: string | undefined,
  inputTokens: number | undefined,
  outputTokens: number | undefined,
): { inputCostUsd?: number; outputCostUsd?: number } {
  if (!metadataJson) return {};
  try {
    const meta = JSON.parse(metadataJson) as Record<string, unknown>;
    const orUsage = (meta["openrouter"] as Record<string, unknown> | undefined)
      ?.["usage"] as Record<string, unknown> | undefined;
    const totalCost = typeof orUsage?.["cost"] === "number" ? orUsage["cost"] : undefined;
    if (totalCost == null) return {};
    const total = (inputTokens ?? 0) + (outputTokens ?? 0);
    if (total === 0) return { inputCostUsd: totalCost };
    return {
      inputCostUsd:  ((inputTokens  ?? 0) / total) * totalCost,
      outputCostUsd: ((outputTokens ?? 0) / total) * totalCost,
    };
  } catch {
    return {};
  }
}

function tryParse(val: string | undefined): unknown {
  if (val === undefined) return undefined;
  try {
    return JSON.parse(val);
  } catch {
    return val;
  }
}

// ── Public types ──────────────────────────────────────────────────────────────

export interface TraceOpts {
  /** Display name for the trace / agent in the Breadcrumb dashboard. */
  name: string;
  /** Input context or query to record on the trace. */
  input?: unknown;
  userId?: string;
  sessionId?: string;
  /** Provide an existing trace ID to resume / continue a trace. */
  id?: string;
  metadata?: Record<string, string>;
}

export interface TraceAgentHandle {
  /**
   * Returns `experimental_telemetry` config for one step of this agent.
   * All LLM + tool spans are automatically nested under the agent trace.
   * The step span is closed when the call completes; the agent remains open.
   *
   * Nested `generateText` calls made inside a tool `execute()` using the
   * same step config are detected via OTEL context and shown as sub-steps.
   *
   * @example
   * ```ts
   * const { text } = await generateText({
   *   model,
   *   prompt,
   *   experimental_telemetry: agent.step("search"),
   * });
   * ```
   */
  step(name?: string): { isEnabled: true; tracer: Tracer };

  /** Start a manually timed span under this agent's trace. */
  track(
    name: string,
    type: BcSpanType,
    opts?: { input?: unknown; model?: string; provider?: string },
  ): BcTimerLike;

  /** Close the agent trace. Call when all steps are complete. */
  end(opts?: { output?: unknown; status?: string; statusMessage?: string }): void;
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Binds a Breadcrumb client to AI SDK telemetry helpers.
 * Call once at startup and export the returned `trace` and `traceAgent`.
 *
 * @example
 * ```ts
 * // lib/tracing.ts
 * import { Breadcrumb } from "@breadcrumb/sdk";
 * import { useAiSdkTracing } from "@breadcrumb/ai-sdk";
 *
 * const bc = new Breadcrumb({ apiKey: process.env.BREADCRUMB_API_KEY! });
 * export const { trace, traceAgent } = useAiSdkTracing(bc);
 * ```
 */
export function useAiSdkTracing(client: BcClient): {
  trace: (opts: TraceOpts) => { isEnabled: true; tracer: Tracer };
  traceAgent: (opts: TraceOpts) => TraceAgentHandle;
} {
  /**
   * Returns `experimental_telemetry` config for a single LLM call.
   * A trace is created automatically and closed when the call resolves.
   *
   * Nested `generateText` calls inside tool `execute()` using the same
   * config are detected via OTEL context and shown as sub-steps.
   *
   * @example
   * ```ts
   * const { text } = await generateText({
   *   model,
   *   prompt: "What is 2+2?",
   *   experimental_telemetry: trace({ name: "math", userId: "u1" }),
   * });
   * ```
   */
  function trace(opts: TraceOpts): { isEnabled: true; tracer: Tracer } {
    const agent = client.agent(opts);
    return {
      isEnabled: true,
      tracer: new BcTracer(agent, true) as unknown as Tracer,
    };
  }

  /**
   * Creates a multi-step agent trace.
   * Use `.step()` for each `generateText`/`streamText` call,
   * then `.end()` when all steps are done.
   *
   * @example
   * ```ts
   * const agent = traceAgent({ name: "research", userId: "u1" });
   *
   * const { text: docs } = await generateText({
   *   model, prompt: "Find docs",
   *   experimental_telemetry: agent.step("search"),
   * });
   *
   * const { text: answer } = await generateText({
   *   model, prompt: `Summarize: ${docs}`,
   *   experimental_telemetry: agent.step("summarize"),
   * });
   *
   * agent.end({ output: answer });
   * ```
   */
  function traceAgent(opts: TraceOpts): TraceAgentHandle {
    const agent = client.agent(opts);

    return {
      step(stepName) {
        const timer = agent.track(stepName ?? "step", "step");
        return {
          isEnabled: true,
          tracer: new BcTracer(timer, true) as unknown as Tracer,
        };
      },

      track(name, type, trackOpts) {
        return agent.track(name, type, trackOpts);
      },

      end(endOpts) {
        agent.end(endOpts ?? {});
      },
    };
  }

  return { trace, traceAgent };
}
