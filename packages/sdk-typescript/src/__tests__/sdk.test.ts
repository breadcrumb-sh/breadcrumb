import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { init } from "../index.js";
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
  let bcWithEnvironment: Breadcrumb;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeAll(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    // batching: false → SimpleSpanProcessor — each span exported immediately on end
    bc = init({ apiKey: "sk-test", baseUrl: "http://localhost:3100", batching: false });
    bcWithEnvironment = init({
      apiKey: "sk-test",
      baseUrl: "http://localhost:3100",
      environment: "production",
      batching: false,
    });
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
      await bcWithEnvironment.trace("my-trace", async () => {});
      await flush();
      const traces = getTraceCalls(fetchMock);
      expect(traces).toHaveLength(1);
      expect(traces[0].environment).toBe("production");
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
