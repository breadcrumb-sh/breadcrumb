import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from "vitest";
import { trace as traceApi, context as contextApi, propagation } from "@opentelemetry/api";
import { SimpleSpanProcessor, BasicTracerProvider } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { init, createBreadcrumbSpanProcessor } from "../index.js";
import type { Breadcrumb } from "../types.js";

// Allow async exports to complete (SimpleSpanProcessor calls fetch async)
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

// ── Helpers ───────────────────────────────────────────────────────────────────

function getSpanByName(fetchMock: ReturnType<typeof vi.fn>, name: string) {
  for (const call of fetchMock.mock.calls as unknown[][]) {
    const url = call[0] as string;
    const opts = call[1] as { body: string };
    if (url.endsWith("/v1/spans")) {
      const spans = JSON.parse(opts.body) as { name: string }[];
      const found = spans.find((s) => s.name === name);
      if (found) return found as Record<string, unknown>;
    }
  }
  return undefined;
}

function getTraceCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return (fetchMock.mock.calls as unknown[][])
    .filter((c) => (c[0] as string).endsWith("/v1/traces"))
    .map((c) => JSON.parse((c[1] as { body: string }).body));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Breadcrumb SDK (integration)", () => {
  let bc: Breadcrumb;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeAll(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    // batching: false → SimpleSpanProcessor — each span exported immediately on end
    bc = init({ apiKey: "sk-test", baseUrl: "http://localhost:3100", batching: false });
  });

  beforeEach(() => {
    fetchMock.mockClear();
  });

  // ── trace() ─────────────────────────────────────────────────────────────────

  describe("trace()", () => {
    it("creates a root trace (sends /v1/traces)", async () => {
      await bc.trace("my-trace", async () => {});
      await flush();
      const traces = getTraceCalls(fetchMock);
      expect(traces).toHaveLength(1);
      expect(traces[0].name).toBe("my-trace");
    });

    it("includes environment in root trace payloads when configured", async () => {
      // Re-init with environment — this shuts down the default provider
      const bcEnv = init({
        apiKey: "sk-test",
        baseUrl: "http://localhost:3100",
        environment: "production",
        batching: false,
      });
      await bcEnv.trace("my-trace", async () => {});
      await flush();
      const traces = getTraceCalls(fetchMock);
      expect(traces).toHaveLength(1);
      expect(traces[0].environment).toBe("production");
      // Restore the default provider for remaining tests
      bc = init({ apiKey: "sk-test", baseUrl: "http://localhost:3100", batching: false });
    });

    it("creates a root span with no parent_span_id", async () => {
      await bc.trace("root", async () => {});
      await flush();
      const span = getSpanByName(fetchMock, "root");
      expect(span?.parent_span_id).toBeUndefined();
    });

    it("returns the value from fn", async () => {
      const result = await bc.trace("test", async () => 42);
      expect(result).toBe(42);
    });

    it("rethrows errors and marks the span as error", async () => {
      await expect(
        bc.trace("failing", async () => {
          throw new Error("oops");
        }),
      ).rejects.toThrow("oops");
      await flush();
      const span = getSpanByName(fetchMock, "failing");
      expect(span?.status).toBe("error");
      expect(span?.status_message).toBe("oops");
    });

    it("is always detached from any active context — nested trace() creates a new root", async () => {
      await bc.trace("outer", async () => {
        await bc.trace("inner", async () => {});
        await flush();
      });
      await flush();

      const inner = getSpanByName(fetchMock, "inner");
      const outer = getSpanByName(fetchMock, "outer");

      // inner is a root: no parent
      expect(inner?.parent_span_id).toBeUndefined();
      // inner and outer have different trace IDs (truly detached)
      expect(inner?.trace_id).not.toBe(outer?.trace_id);
    });
  });

  // ── span() ──────────────────────────────────────────────────────────────────

  describe("span()", () => {
    it("creates a child span when inside trace()", async () => {
      await bc.trace("root", async () => {
        await bc.span("child", async () => {});
      });
      await flush();

      const root = getSpanByName(fetchMock, "root");
      const child = getSpanByName(fetchMock, "child");

      expect(child?.parent_span_id).toBe(root?.id);
      expect(child?.trace_id).toBe(root?.trace_id);
    });

    it("correctly nests deeply — grandchild has span() as parent, not trace()", async () => {
      await bc.trace("root", async () => {
        await bc.span("child", async () => {
          await bc.span("grandchild", async () => {});
        });
      });
      await flush();

      const child = getSpanByName(fetchMock, "child");
      const grandchild = getSpanByName(fetchMock, "grandchild");

      expect(grandchild?.parent_span_id).toBe(child?.id);
    });

    it("creates a root span (and /v1/traces) when called outside any active context", async () => {
      await bc.span("standalone", async () => {});
      await flush();
      const traces = getTraceCalls(fetchMock);
      expect(traces).toHaveLength(1);
      const span = getSpanByName(fetchMock, "standalone");
      expect(span?.parent_span_id).toBeUndefined();
    });

    it("sets breadcrumb.span.type when type option is provided", async () => {
      await bc.trace("root", async () => {
        await bc.span("llm-call", async () => {}, { type: "llm" });
      });
      await flush();
      expect(getSpanByName(fetchMock, "llm-call")?.type).toBe("llm");
    });

    it("returns the value from fn", async () => {
      const result = await bc.span("test", async () => "hello");
      expect(result).toBe("hello");
    });

    it("rethrows errors from fn", async () => {
      await expect(
        bc.span("bad", async () => {
          throw new Error("fail");
        }),
      ).rejects.toThrow("fail");
    });
  });

  // ── BreadcrumbSpan.set() ────────────────────────────────────────────────────

  describe("BreadcrumbSpan.set()", () => {
    it("metadata sub-object appears in span metadata", async () => {
      await bc.trace("test", async (span) => {
        span.set({ metadata: { str: "hello", num: 42, bool: true } });
      });
      await flush();
      const span = getSpanByName(fetchMock, "test");
      expect(span?.metadata).toMatchObject({
        str: "hello",
        num: "42",
        bool: "true",
      });
    });

    it("input and output appear as top-level fields", async () => {
      await bc.trace("test", async (span) => {
        span.set({ input: "my question", output: "my answer" });
      });
      await flush();
      const span = getSpanByName(fetchMock, "test");
      expect(span?.input).toBe("my question");
      expect(span?.output).toBe("my answer");
    });

    it("object input is parsed back from JSON", async () => {
      await bc.trace("test", async (span) => {
        span.set({ input: { a: 1, b: [2, 3] } });
      });
      await flush();
      const span = getSpanByName(fetchMock, "test");
      expect(span?.input).toEqual({ a: 1, b: [2, 3] });
    });

    it("silently ignores null and undefined values", async () => {
      await expect(
        bc.trace("test", async (span) => {
          span.set({ input: null as unknown as string, output: undefined });
        }),
      ).resolves.toBeUndefined();
    });

    it("model/provider/tokens appear as top-level fields", async () => {
      await bc.trace("test", async (span) => {
        span.set({ model: "gpt-4o", provider: "openai", input_tokens: 100, output_tokens: 50 });
      });
      await flush();
      const span = getSpanByName(fetchMock, "test");
      expect(span?.model).toBe("gpt-4o");
      expect(span?.provider).toBe("openai");
      expect(span?.input_tokens).toBe(100);
      expect(span?.output_tokens).toBe(50);
    });
  });
});

// ── OTel isolation ─────────────────────────────────────────────────────────────

/** Create a mock exporter that records exported spans */
function createMockExporter() {
  const exported: unknown[][] = [];
  return {
    exported,
    exporter: {
      export: vi.fn((spans: unknown[], cb: (r: { code: number }) => void) => {
        exported.push(spans);
        cb({ code: 0 });
      }),
      shutdown: vi.fn().mockResolvedValue(undefined),
      forceFlush: vi.fn().mockResolvedValue(undefined),
    },
  };
}

describe("OTel isolation", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeAll(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
  });

  beforeEach(() => {
    fetchMock.mockClear();
  });

  afterEach(() => {
    traceApi.disable();
  });

  it("init() does not register a global tracer provider", () => {
    init({ apiKey: "sk-test", baseUrl: "http://localhost:3100", batching: false });
    const globalTracer = traceApi.getTracerProvider().getTracer("test");
    const span = globalTracer.startSpan("probe");
    expect(span.isRecording()).toBe(false);
    span.end();
  });

  it("Breadcrumb spans are not swallowed by a Sentry-like global provider", async () => {
    // Simulate Sentry: register a global provider that captures spans
    const sentry = createMockExporter();
    const sentryProvider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(sentry.exporter as any)],
    });
    sentryProvider.register();

    const bc = init({ apiKey: "sk-test", baseUrl: "http://localhost:3100", batching: false });

    await bc.trace("bc-trace", async () => {
      await bc.span("bc-child", async () => {});
    });
    await flush();

    // Breadcrumb spans reach Breadcrumb's exporter (fetch)
    const bcSpan = getSpanByName(fetchMock, "bc-trace");
    const bcChild = getSpanByName(fetchMock, "bc-child");
    expect(bcSpan).toBeDefined();
    expect(bcChild).toBeDefined();
    expect(bcChild?.parent_span_id).toBe(bcSpan?.id);

    // Sentry's exporter does NOT receive Breadcrumb spans
    const sentrySpanNames = sentry.exported.flat().map((s: any) => s.name);
    expect(sentrySpanNames).not.toContain("bc-trace");
    expect(sentrySpanNames).not.toContain("bc-child");

    await sentryProvider.shutdown();
  });

  it("Sentry-like global provider spans are not swallowed by Breadcrumb", async () => {
    const sentry = createMockExporter();
    const sentryProvider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(sentry.exporter as any)],
    });
    sentryProvider.register();

    init({ apiKey: "sk-test", baseUrl: "http://localhost:3100", batching: false });

    // Create a span through the global provider (as Sentry would)
    const globalTracer = traceApi.getTracer("sentry");
    const sentrySpan = globalTracer.startSpan("http-request");
    sentrySpan.end();
    await flush();

    // Sentry's exporter receives the span
    const sentrySpanNames = sentry.exported.flat().map((s: any) => s.name);
    expect(sentrySpanNames).toContain("http-request");

    // Breadcrumb's exporter does NOT receive it
    const bcSpanCalls = (fetchMock.mock.calls as unknown[][]).filter(
      (c) => (c[0] as string).endsWith("/v1/spans"),
    );
    const allBcSpanNames = bcSpanCalls.flatMap((c) => {
      const body = JSON.parse((c[1] as { body: string }).body);
      return (Array.isArray(body) ? body : [body]).map((s: any) => s.name);
    });
    expect(allBcSpanNames).not.toContain("http-request");

    await sentryProvider.shutdown();
  });

  it("works alongside a Langfuse-like global provider without interference", async () => {
    // Simulate Langfuse: registers globally to capture AI SDK spans
    const langfuse = createMockExporter();
    const langfuseProvider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(langfuse.exporter as any)],
    });
    langfuseProvider.register();

    const bc = init({ apiKey: "sk-test", baseUrl: "http://localhost:3100", batching: false });

    // Breadcrumb manual tracing works
    await bc.trace("bc-work", async () => {});
    await flush();
    expect(getSpanByName(fetchMock, "bc-work")).toBeDefined();

    // Langfuse captures its own spans via the global provider
    const langfuseTracer = traceApi.getTracer("langfuse");
    const lfSpan = langfuseTracer.startSpan("ai.generateText");
    lfSpan.end();
    await flush();
    const lfNames = langfuse.exported.flat().map((s: any) => s.name);
    expect(lfNames).toContain("ai.generateText");

    // Langfuse does NOT get Breadcrumb's spans
    expect(lfNames).not.toContain("bc-work");

    await langfuseProvider.shutdown();
  });

  it("works alongside BOTH Sentry-like and Langfuse-like providers", async () => {
    // Simulate both tools registered globally
    const sentry = createMockExporter();
    const langfuse = createMockExporter();
    const sharedProvider = new NodeTracerProvider({
      spanProcessors: [
        new SimpleSpanProcessor(sentry.exporter as any),
        new SimpleSpanProcessor(langfuse.exporter as any),
      ],
    });
    sharedProvider.register();

    const bc = init({ apiKey: "sk-test", baseUrl: "http://localhost:3100", batching: false });

    // Breadcrumb works independently
    await bc.trace("bc-isolated", async () => {
      await bc.span("bc-child-isolated", async () => {});
    });
    await flush();
    expect(getSpanByName(fetchMock, "bc-isolated")).toBeDefined();
    expect(getSpanByName(fetchMock, "bc-child-isolated")).toBeDefined();

    // Global spans go to both Sentry and Langfuse, not Breadcrumb
    const globalTracer = traceApi.getTracer("app");
    const globalSpan = globalTracer.startSpan("global-work");
    globalSpan.end();
    await flush();

    const sentryNames = sentry.exported.flat().map((s: any) => s.name);
    const langfuseNames = langfuse.exported.flat().map((s: any) => s.name);

    expect(sentryNames).toContain("global-work");
    expect(langfuseNames).toContain("global-work");
    // Neither Sentry nor Langfuse swallowed Breadcrumb spans
    expect(sentryNames).not.toContain("bc-isolated");
    expect(langfuseNames).not.toContain("bc-isolated");

    await sharedProvider.shutdown();
  });

  it("concurrent traces do not leak context to each other", async () => {
    const bc = init({ apiKey: "sk-test", baseUrl: "http://localhost:3100", batching: false });
    fetchMock.mockClear();

    await Promise.all([
      bc.trace("trace-a", async () => {
        await bc.span("child-a", async () => {});
      }),
      bc.trace("trace-b", async () => {
        await bc.span("child-b", async () => {});
      }),
    ]);
    await flush();

    const traceA = getSpanByName(fetchMock, "trace-a");
    const childA = getSpanByName(fetchMock, "child-a");
    const traceB = getSpanByName(fetchMock, "trace-b");
    const childB = getSpanByName(fetchMock, "child-b");

    expect(childA?.trace_id).toBe(traceA?.trace_id);
    expect(childB?.trace_id).toBe(traceB?.trace_id);
    expect(traceA?.trace_id).not.toBe(traceB?.trace_id);
  });

  it("Breadcrumb spans have correct parent-child even with active global context", async () => {
    // Simulate Sentry having an active span in the global context
    const sentry = createMockExporter();
    const sentryProvider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(sentry.exporter as any)],
    });
    sentryProvider.register();

    const bc = init({ apiKey: "sk-test", baseUrl: "http://localhost:3100", batching: false });

    // Start a Sentry span that stays active in the global context
    const sentryTracer = traceApi.getTracer("sentry");
    sentryTracer.startActiveSpan("sentry-request", async (sentrySpan) => {
      // While Sentry's span is active, Breadcrumb should still work independently
      await bc.trace("bc-inner", async () => {
        await bc.span("bc-deep", async () => {});
      });
      await flush();

      const bcInner = getSpanByName(fetchMock, "bc-inner");
      const bcDeep = getSpanByName(fetchMock, "bc-deep");

      // Breadcrumb trace is a root — NOT parented under Sentry's span
      expect(bcInner?.parent_span_id).toBeUndefined();
      // Breadcrumb child is parented under Breadcrumb trace, not Sentry
      expect(bcDeep?.parent_span_id).toBe(bcInner?.id);
      expect(bcDeep?.trace_id).toBe(bcInner?.trace_id);

      sentrySpan.end();
    });

    await sentryProvider.shutdown();
  });

  it("works when Sentry-like tool takes over the global context manager (skipOpenTelemetrySetup: false)", async () => {
    // Simulate Sentry's default behavior: register a provider AND a context manager
    const sentry = createMockExporter();
    const sentryContextManager = new AsyncLocalStorageContextManager();
    sentryContextManager.enable();
    const sentryProvider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(sentry.exporter as any)],
    });
    sentryProvider.register({
      contextManager: sentryContextManager,
    });

    const bc = init({ apiKey: "sk-test", baseUrl: "http://localhost:3100", batching: false });

    // Sentry creates an active request span using the global context manager
    const sentryTracer = traceApi.getTracer("sentry");
    await sentryTracer.startActiveSpan("sentry-http-handler", async (sentrySpan) => {
      // Inside Sentry's active context, create Breadcrumb traces
      await bc.trace("bc-during-sentry", async () => {
        await bc.span("bc-child-during-sentry", async () => {});
      });
      await flush();

      const bcTrace = getSpanByName(fetchMock, "bc-during-sentry");
      const bcChild = getSpanByName(fetchMock, "bc-child-during-sentry");

      // Breadcrumb trace is a root — NOT parented under Sentry's span
      expect(bcTrace?.parent_span_id).toBeUndefined();
      // Breadcrumb parent-child is correct
      expect(bcChild?.parent_span_id).toBe(bcTrace?.id);
      expect(bcChild?.trace_id).toBe(bcTrace?.trace_id);

      // Sentry does NOT see Breadcrumb spans
      const sentryNames = sentry.exported.flat().map((s: any) => s.name);
      expect(sentryNames).not.toContain("bc-during-sentry");
      expect(sentryNames).not.toContain("bc-child-during-sentry");

      sentrySpan.end();
    });
    await flush();

    // Sentry's own spans still work
    const sentryNames = sentry.exported.flat().map((s: any) => s.name);
    expect(sentryNames).toContain("sentry-http-handler");

    sentryContextManager.disable();
    await sentryProvider.shutdown();
  });

  it("works when Sentry-like provider registers AFTER Breadcrumb init", async () => {
    const bc = init({ apiKey: "sk-test", baseUrl: "http://localhost:3100", batching: false });

    // Sentry registers after Breadcrumb — this is common in app startup
    const sentry = createMockExporter();
    const sentryProvider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(sentry.exporter as any)],
    });
    sentryProvider.register();

    // Breadcrumb still works
    await bc.trace("bc-after-sentry-init", async () => {
      await bc.span("bc-child-after", async () => {});
    });
    await flush();

    const bcTrace = getSpanByName(fetchMock, "bc-after-sentry-init");
    const bcChild = getSpanByName(fetchMock, "bc-child-after");
    expect(bcTrace).toBeDefined();
    expect(bcChild?.parent_span_id).toBe(bcTrace?.id);

    // Sentry still works
    const globalTracer = traceApi.getTracer("sentry");
    const sentrySpan = globalTracer.startSpan("late-sentry-span");
    sentrySpan.end();
    await flush();
    const sentryNames = sentry.exported.flat().map((s: any) => s.name);
    expect(sentryNames).toContain("late-sentry-span");
    expect(sentryNames).not.toContain("bc-after-sentry-init");

    await sentryProvider.shutdown();
  });

  it("works after re-init() while a foreign provider is registered", async () => {
    const sentry = createMockExporter();
    const sentryProvider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(sentry.exporter as any)],
    });
    sentryProvider.register();

    // First init
    let bc = init({ apiKey: "sk-test", baseUrl: "http://localhost:3100", batching: false });
    await bc.trace("first-init", async () => {});
    await flush();
    expect(getSpanByName(fetchMock, "first-init")).toBeDefined();

    // Re-init (e.g. config change) — should not break Sentry
    fetchMock.mockClear();
    bc = init({ apiKey: "sk-test-2", baseUrl: "http://localhost:3100", batching: false });
    await bc.trace("second-init", async () => {});
    await flush();
    expect(getSpanByName(fetchMock, "second-init")).toBeDefined();

    // Sentry unaffected by re-init
    sentry.exported.length = 0;
    const globalTracer = traceApi.getTracer("sentry");
    const span = globalTracer.startSpan("after-reinit");
    span.end();
    await flush();
    const sentryNames = sentry.exported.flat().map((s: any) => s.name);
    expect(sentryNames).toContain("after-reinit");

    await sentryProvider.shutdown();
  });

  it("spans via __provider.getTracer() flow through Breadcrumb exporter (AI SDK path)", async () => {
    const bc = init({ apiKey: "sk-test", baseUrl: "http://localhost:3100", batching: false });
    fetchMock.mockClear();

    // This is what the AI SDK does: uses the tracer from experimental_telemetry.tracer
    // The AI SDK calls startActiveSpan which uses the global context for parenting.
    // Our private provider's tracer still processes spans through our exporter.
    const aiTracer = bc.__provider.getTracer("@breadcrumb-sdk/ai-sdk");

    // Simulate AI SDK: startActiveSpan nests child spans under the root
    await aiTracer.startActiveSpan("ai.generateText", async (rootSpan) => {
      await aiTracer.startActiveSpan("ai.generateText.doGenerate", async (childSpan) => {
        childSpan.setAttribute("ai.model.id", "gpt-4o");
        childSpan.setAttribute("ai.usage.inputTokens", 100);
        childSpan.end();
      });
      await aiTracer.startActiveSpan("ai.toolCall", async (toolSpan) => {
        toolSpan.setAttribute("ai.toolCall.name", "search");
        toolSpan.end();
      });
      rootSpan.end();
    });
    await flush();

    // All spans reach Breadcrumb's exporter
    const allSpanCalls = (fetchMock.mock.calls as unknown[][]).filter(
      (c) => (c[0] as string).endsWith("/v1/spans"),
    );
    const allSpanNames = allSpanCalls.flatMap((c) => {
      const body = JSON.parse((c[1] as { body: string }).body);
      return (Array.isArray(body) ? body : [body]).map((s: any) => s.name);
    });

    expect(allSpanNames).toContain("ai.generateText");
    expect(allSpanNames).toContain("ai.generateText.doGenerate");
    // ai.toolCall is renamed to the tool name by our AI SDK mapper
    expect(allSpanNames).toContain("search");
  });

  it("__provider tracer spans reach Breadcrumb but NOT a Sentry-like global provider", async () => {
    const sentry = createMockExporter();
    const sentryProvider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(sentry.exporter as any)],
    });
    sentryProvider.register();

    const bc = init({ apiKey: "sk-test", baseUrl: "http://localhost:3100", batching: false });
    fetchMock.mockClear();

    // AI SDK span via our private tracer
    const aiTracer = bc.__provider.getTracer("ai");
    const span = aiTracer.startSpan("ai.generateText");
    span.setAttribute("ai.model.id", "claude-4");
    span.end();
    await flush();

    // Breadcrumb receives it
    const bcSpanCalls = (fetchMock.mock.calls as unknown[][]).filter(
      (c) => (c[0] as string).endsWith("/v1/spans"),
    );
    expect(bcSpanCalls.length).toBeGreaterThan(0);

    // Sentry does NOT receive it
    const sentryNames = sentry.exported.flat().map((s: any) => s.name);
    expect(sentryNames).not.toContain("ai.generateText");

    await sentryProvider.shutdown();
  });

  it("AI SDK spans via __provider nest under bc.trace() when called inside one", async () => {
    // This is the critical integration test: when the AI SDK's generateText
    // is called inside bc.trace(), the AI SDK spans should be children of
    // the Breadcrumb trace (same trace_id, parent linked).
    const bc = init({ apiKey: "sk-test", baseUrl: "http://localhost:3100", batching: false });
    fetchMock.mockClear();

    await bc.trace("my-agent", async () => {
      // Simulate AI SDK calling startActiveSpan on our provider's tracer
      const aiTracer = bc.__provider.getTracer("ai");
      await aiTracer.startActiveSpan("ai.generateText", async (genSpan) => {
        await aiTracer.startActiveSpan("ai.generateText.doGenerate", async (doGenSpan) => {
          doGenSpan.end();
        });
        genSpan.end();
      });
    });
    await flush();

    const myAgent = getSpanByName(fetchMock, "my-agent");
    const genText = getSpanByName(fetchMock, "ai.generateText");
    const doGen = getSpanByName(fetchMock, "ai.generateText.doGenerate");

    // All three must exist
    expect(myAgent).toBeDefined();
    expect(genText).toBeDefined();
    expect(doGen).toBeDefined();

    // AI SDK root span is a child of our trace
    expect(genText?.trace_id).toBe(myAgent?.trace_id);
    expect(genText?.parent_span_id).toBe(myAgent?.id);

    // AI SDK child is a child of the AI SDK root
    expect(doGen?.trace_id).toBe(myAgent?.trace_id);
    expect(doGen?.parent_span_id).toBe(genText?.id);
  });

  it("AI SDK spans via __provider create a trace even when Sentry has an active span", async () => {
    // This simulates: Sentry traces an HTTP request, and inside that request
    // the AI SDK makes an LLM call using our private tracer. The AI SDK uses
    // startActiveSpan which reads from the global context — so Sentry's span
    // could become the parent. We need to ensure a /v1/traces call is still made.
    const sentry = createMockExporter();
    const sentryContextManager = new AsyncLocalStorageContextManager();
    sentryContextManager.enable();
    const sentryProvider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(sentry.exporter as any)],
    });
    sentryProvider.register({ contextManager: sentryContextManager });

    const bc = init({ apiKey: "sk-test", baseUrl: "http://localhost:3100", batching: false });
    fetchMock.mockClear();

    const sentryTracer = traceApi.getTracer("sentry");
    await sentryTracer.startActiveSpan("http-request", async (sentrySpan) => {
      // AI SDK creates spans using our tracer, but global context has Sentry's span
      const aiTracer = bc.__provider.getTracer("ai");
      await aiTracer.startActiveSpan("ai.generateText", async (rootSpan) => {
        await aiTracer.startActiveSpan("ai.generateText.doGenerate", async (childSpan) => {
          childSpan.end();
        });
        rootSpan.end();
      });
      await flush();

      sentrySpan.end();
    });
    await flush();

    // A /v1/traces call must have been made for the AI SDK trace
    const traceCalls = getTraceCalls(fetchMock);
    expect(traceCalls.length).toBeGreaterThan(0);

    // The spans must also have been sent
    const allSpanCalls = (fetchMock.mock.calls as unknown[][]).filter(
      (c) => (c[0] as string).endsWith("/v1/spans"),
    );
    const allSpanNames = allSpanCalls.flatMap((c) => {
      const body = JSON.parse((c[1] as { body: string }).body);
      return (Array.isArray(body) ? body : [body]).map((s: any) => s.name);
    });
    expect(allSpanNames).toContain("ai.generateText");
    expect(allSpanNames).toContain("ai.generateText.doGenerate");

    sentryContextManager.disable();
    await sentryProvider.shutdown();
  });
});

// ── createBreadcrumbSpanProcessor ──────────────────────────────────────────────

describe("createBreadcrumbSpanProcessor()", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeAll(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
  });

  beforeEach(() => {
    fetchMock.mockClear();
  });

  afterEach(() => {
    traceApi.disable();
  });

  it("exposes the provider's tracer via __provider", () => {
    const bc = init({ apiKey: "sk-test", baseUrl: "http://localhost:3100", batching: false });
    expect(bc.__provider).toBeDefined();
    const tracer = bc.__provider.getTracer("test");
    expect(tracer).toBeDefined();
  });

  it("returns a processor that exports spans to the Breadcrumb API", async () => {
    const processor = createBreadcrumbSpanProcessor({
      apiKey: "sk-test",
      baseUrl: "http://localhost:3100",
      batching: false,
    });

    const provider = new NodeTracerProvider({ spanProcessors: [processor] });
    const tracer = provider.getTracer("test");

    const span = tracer.startSpan("test-span");
    span.end();
    await flush();

    const spanCalls = (fetchMock.mock.calls as unknown[][]).filter(
      (c) => (c[0] as string).endsWith("/v1/spans"),
    );
    expect(spanCalls.length).toBeGreaterThan(0);

    await provider.shutdown();
  });

  it("works in a shared provider alongside a Langfuse-like processor", async () => {
    const langfuse = createMockExporter();
    const bcProcessor = createBreadcrumbSpanProcessor({
      apiKey: "sk-test",
      baseUrl: "http://localhost:3100",
      batching: false,
    });

    // Shared provider with both Breadcrumb and Langfuse processors
    const sharedProvider = new NodeTracerProvider({
      spanProcessors: [
        bcProcessor,
        new SimpleSpanProcessor(langfuse.exporter as any),
      ],
    });
    const tracer = sharedProvider.getTracer("ai");

    const span = tracer.startSpan("ai.generateText");
    span.setAttribute("ai.model.id", "gpt-4o");
    span.end();
    await flush();

    // Breadcrumb receives the span
    const bcSpanCalls = (fetchMock.mock.calls as unknown[][]).filter(
      (c) => (c[0] as string).endsWith("/v1/spans"),
    );
    expect(bcSpanCalls.length).toBeGreaterThan(0);

    // Langfuse also receives the same span
    const lfNames = langfuse.exported.flat().map((s: any) => s.name);
    expect(lfNames).toContain("ai.generateText");

    await sharedProvider.shutdown();
  });
});

// ── Bundler compatibility ───────────────────────────────────────────────────

describe("Bundler compatibility", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeAll(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
  });

  it("__provider is a BasicTracerProvider, not NodeTracerProvider (no sdk-trace-node dep)", () => {
    const bc = init({ apiKey: "sk-test", baseUrl: "http://localhost:3100", batching: false });
    // The SDK should use BasicTracerProvider to avoid pulling in
    // @opentelemetry/sdk-trace-node and its transitive context-async-hooks dep.
    expect(bc.__provider).toBeInstanceOf(BasicTracerProvider);
    expect(bc.__provider).not.toBeInstanceOf(NodeTracerProvider);
  });
});
