import { describe, it, expect, beforeEach, vi } from "vitest";
import { BreadcrumbSpanExporter } from "../exporter.js";
import { SpanStatusCode, SpanKind } from "@opentelemetry/api";
import { ExportResultCode } from "@opentelemetry/core";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import type { ExportResult } from "@opentelemetry/core";

// ── Helpers ───────────────────────────────────────────────────────────────────

const TRACE_ID = "a".repeat(32);
const SPAN_ID = "b".repeat(16);
const PARENT_ID = "c".repeat(16);

function toHrTime(ms: number): [number, number] {
  return [Math.floor(ms / 1000), (ms % 1000) * 1_000_000];
}

function makeSpan(
  overrides: Partial<{
    name: string;
    traceId: string;
    spanId: string;
    parentSpanId: string;
    startMs: number;
    endMs: number;
    statusCode: SpanStatusCode;
    statusMessage: string;
    attributes: Record<string, string | number | boolean>;
  }> = {},
): ReadableSpan {
  const {
    name = "test-span",
    traceId = TRACE_ID,
    spanId = SPAN_ID,
    parentSpanId,
    startMs = 1_700_000_000_000,
    endMs = 1_700_000_000_500,
    statusCode = SpanStatusCode.UNSET,
    statusMessage,
    attributes = {},
  } = overrides;

  return {
    name,
    kind: SpanKind.INTERNAL,
    spanContext: () => ({ traceId, spanId, traceFlags: 1, isRemote: false }),
    parentSpanId,
    startTime: toHrTime(startMs),
    endTime: toHrTime(endMs),
    status: { code: statusCode, message: statusMessage },
    attributes,
    events: [],
    links: [],
    resource: {} as never,
    instrumentationLibrary: { name: "test" },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
    ended: true,
    duration: toHrTime(endMs - startMs),
  } as unknown as ReadableSpan;
}

function exportSpans(
  exporter: BreadcrumbSpanExporter,
  spans: ReadableSpan[],
): Promise<ExportResult> {
  return new Promise((resolve) => exporter.export(spans, resolve));
}

function getTracesBody(fetchMock: ReturnType<typeof vi.fn>) {
  const call = (fetchMock.mock.calls as unknown[][]).find(
    (c) => (c[0] as string).endsWith("/v1/traces"),
  );
  return call ? JSON.parse((call[1] as { body: string }).body) : undefined;
}

function getSpansBody(fetchMock: ReturnType<typeof vi.fn>) {
  const call = (fetchMock.mock.calls as unknown[][]).find(
    (c) => (c[0] as string).endsWith("/v1/spans"),
  );
  return call ? JSON.parse((call[1] as { body: string }).body) : undefined;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("BreadcrumbSpanExporter", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let exporter: BreadcrumbSpanExporter;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    exporter = new BreadcrumbSpanExporter("test-api-key", "http://localhost:3100");
  });

  // ── Authorization ───────────────────────────────────────────────────────────

  describe("authorization", () => {
    it("sends Bearer token in every request", async () => {
      await exportSpans(exporter, [makeSpan()]);
      for (const [, opts] of fetchMock.mock.calls) {
        expect(opts.headers.Authorization).toBe("Bearer test-api-key");
      }
    });
  });

  // ── Root span routing ───────────────────────────────────────────────────────

  describe("root span (no parent)", () => {
    it("posts to /v1/traces using the trace ID as id", async () => {
      await exportSpans(exporter, [makeSpan({ traceId: TRACE_ID })]);
      const body = getTracesBody(fetchMock);
      expect(body).toBeDefined();
      expect(body.id).toBe(TRACE_ID);
    });

    it("posts to /v1/spans using the span ID as id", async () => {
      await exportSpans(exporter, [makeSpan({ spanId: SPAN_ID })]);
      const [span] = getSpansBody(fetchMock);
      expect(span.id).toBe(SPAN_ID);
      expect(span.trace_id).toBe(TRACE_ID);
    });

    it("omits parent_span_id from the span payload", async () => {
      await exportSpans(exporter, [makeSpan()]);
      const [span] = getSpansBody(fetchMock);
      expect(span.parent_span_id).toBeUndefined();
    });

    it("includes name, start_time, end_time, status in the trace payload", async () => {
      await exportSpans(exporter, [makeSpan({ name: "my-trace" })]);
      const body = getTracesBody(fetchMock);
      expect(body.name).toBe("my-trace");
      expect(body.start_time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(body.end_time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(body.status).toBe("ok");
    });
  });

  // ── Child span routing ──────────────────────────────────────────────────────

  describe("child span (has parent)", () => {
    it("does NOT post to /v1/traces", async () => {
      await exportSpans(exporter, [makeSpan({ parentSpanId: PARENT_ID })]);
      expect(getTracesBody(fetchMock)).toBeUndefined();
    });

    it("posts to /v1/spans with parent_span_id set", async () => {
      await exportSpans(exporter, [makeSpan({ spanId: SPAN_ID, parentSpanId: PARENT_ID })]);
      const [span] = getSpansBody(fetchMock);
      expect(span.parent_span_id).toBe(PARENT_ID);
    });
  });

  // ── Batching ────────────────────────────────────────────────────────────────

  describe("batching", () => {
    it("sends multiple spans in a single /v1/spans request", async () => {
      const spans = [
        makeSpan({ spanId: "b".repeat(16) }),
        makeSpan({ spanId: "d".repeat(16), parentSpanId: "b".repeat(16) }),
        makeSpan({ spanId: "e".repeat(16), parentSpanId: "b".repeat(16) }),
      ];
      await exportSpans(exporter, spans);

      const spanCalls = (fetchMock.mock.calls as unknown[][]).filter(
        (c) => (c[0] as string).endsWith("/v1/spans"),
      );
      expect(spanCalls).toHaveLength(1);
      expect(JSON.parse((spanCalls[0][1] as { body: string }).body)).toHaveLength(3);
    });

    it("sends one /v1/traces request per root span in the batch", async () => {
      const spans = [
        makeSpan({ traceId: "a".repeat(32), spanId: "b".repeat(16) }),
        makeSpan({ traceId: "c".repeat(32), spanId: "d".repeat(16) }),
      ];
      await exportSpans(exporter, spans);

      const traceCalls = (fetchMock.mock.calls as unknown[][]).filter(
        (c) => (c[0] as string).endsWith("/v1/traces"),
      );
      expect(traceCalls).toHaveLength(2);
    });
  });

  // ── Status mapping ──────────────────────────────────────────────────────────

  describe("status mapping", () => {
    it("maps UNSET status to 'ok'", async () => {
      await exportSpans(exporter, [makeSpan({ statusCode: SpanStatusCode.UNSET })]);
      expect(getSpansBody(fetchMock)[0].status).toBe("ok");
    });

    it("maps OK status to 'ok'", async () => {
      await exportSpans(exporter, [makeSpan({ statusCode: SpanStatusCode.OK })]);
      expect(getSpansBody(fetchMock)[0].status).toBe("ok");
    });

    it("maps ERROR status to 'error' with message", async () => {
      await exportSpans(exporter, [
        makeSpan({ statusCode: SpanStatusCode.ERROR, statusMessage: "boom" }),
      ]);
      const [span] = getSpansBody(fetchMock);
      expect(span.status).toBe("error");
      expect(span.status_message).toBe("boom");
    });

    it("propagates error status to the /v1/traces payload", async () => {
      await exportSpans(exporter, [makeSpan({ statusCode: SpanStatusCode.ERROR })]);
      expect(getTracesBody(fetchMock).status).toBe("error");
    });

    it("omits status_message when span has no message", async () => {
      await exportSpans(exporter, [makeSpan({ statusCode: SpanStatusCode.OK })]);
      expect(getSpansBody(fetchMock)[0].status_message).toBeUndefined();
    });
  });

  // ── Timestamp conversion ────────────────────────────────────────────────────

  describe("timestamps", () => {
    it("converts HrTime to ISO 8601 strings", async () => {
      await exportSpans(exporter, [
        makeSpan({ startMs: 1_700_000_000_000, endMs: 1_700_000_000_500 }),
      ]);
      const [span] = getSpansBody(fetchMock);
      expect(span.start_time).toBe(new Date(1_700_000_000_000).toISOString());
      expect(span.end_time).toBe(new Date(1_700_000_000_500).toISOString());
    });
  });

  // ── Span type inference ─────────────────────────────────────────────────────

  describe("span type inference", () => {
    it("uses explicit breadcrumb.span.type attribute", async () => {
      await exportSpans(exporter, [
        makeSpan({ attributes: { "breadcrumb.span.type": "retrieval" } }),
      ]);
      expect(getSpansBody(fetchMock)[0].type).toBe("retrieval");
    });

    it.each([
      ["ai.generateText", "llm"],
      ["ai.generateText.doGenerate", "llm"],
      ["ai.streamText", "llm"],
      ["ai.streamText.doStream", "llm"],
      ["ai.generateObject", "llm"],
      ["ai.generateObject.doGenerate", "llm"],
      ["ai.generateObject.doStream", "llm"],
      ["ai.toolCall", "tool"],
      ["ai.toolExecution", "tool"],
      ["ai.executeToolCall", "tool"],
    ])('infers span name "%s" → type "%s"', async (name, expected) => {
      await exportSpans(exporter, [makeSpan({ name })]);
      expect(getSpansBody(fetchMock)[0].type).toBe(expected);
    });

    it("defaults to 'custom' for unrecognized span names", async () => {
      await exportSpans(exporter, [makeSpan({ name: "my-custom-step" })]);
      expect(getSpansBody(fetchMock)[0].type).toBe("custom");
    });

    it("explicit type wins over AI SDK span name", async () => {
      await exportSpans(exporter, [
        makeSpan({
          name: "ai.toolCall",
          attributes: { "breadcrumb.span.type": "step" },
        }),
      ]);
      expect(getSpansBody(fetchMock)[0].type).toBe("step");
    });
  });

  // ── LLM attribute mapping ───────────────────────────────────────────────────

  describe("LLM attribute mapping", () => {
    it("maps ai.model.id → model and ai.model.provider → provider", async () => {
      await exportSpans(exporter, [
        makeSpan({ attributes: { "ai.model.id": "gpt-4o", "ai.model.provider": "openai" } }),
      ]);
      const [span] = getSpansBody(fetchMock);
      expect(span.model).toBe("gpt-4o");
      expect(span.provider).toBe("openai");
    });

    it("maps ai.usage.inputTokens and ai.usage.outputTokens", async () => {
      await exportSpans(exporter, [
        makeSpan({ attributes: { "ai.usage.inputTokens": 100, "ai.usage.outputTokens": 50 } }),
      ]);
      const [span] = getSpansBody(fetchMock);
      expect(span.input_tokens).toBe(100);
      expect(span.output_tokens).toBe(50);
    });

    it("falls back to promptTokens/completionTokens naming (AI SDK v4 style)", async () => {
      await exportSpans(exporter, [
        makeSpan({
          attributes: {
            "ai.usage.promptTokens": 80,
            "ai.usage.completionTokens": 40,
          },
        }),
      ]);
      const [span] = getSpansBody(fetchMock);
      expect(span.input_tokens).toBe(80);
      expect(span.output_tokens).toBe(40);
    });

    it("falls back to gen_ai OpenTelemetry semantic conventions", async () => {
      await exportSpans(exporter, [
        makeSpan({
          attributes: {
            "gen_ai.request.model": "claude-3-opus",
            "gen_ai.system": "anthropic",
            "gen_ai.usage.input_tokens": 60,
            "gen_ai.usage.output_tokens": 30,
          },
        }),
      ]);
      const [span] = getSpansBody(fetchMock);
      expect(span.model).toBe("claude-3-opus");
      expect(span.provider).toBe("anthropic");
      expect(span.input_tokens).toBe(60);
      expect(span.output_tokens).toBe(30);
    });

    it("rounds fractional token counts", async () => {
      await exportSpans(exporter, [
        makeSpan({ attributes: { "ai.usage.inputTokens": 100.7 } }),
      ]);
      expect(getSpansBody(fetchMock)[0].input_tokens).toBe(101);
    });

    it("omits model/provider/tokens when absent", async () => {
      await exportSpans(exporter, [makeSpan()]);
      const [span] = getSpansBody(fetchMock);
      expect(span.model).toBeUndefined();
      expect(span.provider).toBeUndefined();
      expect(span.input_tokens).toBeUndefined();
      expect(span.output_tokens).toBeUndefined();
    });
  });

  // ── Metadata ────────────────────────────────────────────────────────────────

  describe("metadata", () => {
    it("collects unknown attributes into metadata as strings", async () => {
      await exportSpans(exporter, [
        makeSpan({ attributes: { "custom.key": "value", "score": 0.9 } }),
      ]);
      expect(getSpansBody(fetchMock)[0].metadata).toEqual({
        "custom.key": "value",
        score: "0.9",
      });
    });

    it("excludes known LLM attributes from metadata", async () => {
      await exportSpans(exporter, [
        makeSpan({
          attributes: {
            "ai.model.id": "gpt-4o",
            "ai.usage.inputTokens": 10,
            "breadcrumb.span.type": "llm",
          },
        }),
      ]);
      expect(getSpansBody(fetchMock)[0].metadata).toBeUndefined();
    });

    it("omits metadata field entirely when no unknown attributes", async () => {
      await exportSpans(exporter, [makeSpan()]);
      expect(getSpansBody(fetchMock)[0].metadata).toBeUndefined();
    });
  });

  // ── Mapper merge behaviour ──────────────────────────────────────────────────
  //
  // breadcrumb.* attributes (set by the user via span.set()) should always win
  // over values inferred from AI SDK attributes.

  describe("mapper merge — breadcrumb overrides AI SDK", () => {
    it("breadcrumb.model overrides ai.model.id", async () => {
      await exportSpans(exporter, [
        makeSpan({
          attributes: { "ai.model.id": "gpt-4o", "breadcrumb.model": "my-custom-model" },
        }),
      ]);
      expect(getSpansBody(fetchMock)[0].model).toBe("my-custom-model");
    });

    it("breadcrumb.provider overrides ai.model.provider", async () => {
      await exportSpans(exporter, [
        makeSpan({
          attributes: { "ai.model.provider": "openai", "breadcrumb.provider": "my-provider" },
        }),
      ]);
      expect(getSpansBody(fetchMock)[0].provider).toBe("my-provider");
    });

    it("breadcrumb.input overrides ai.prompt.messages", async () => {
      const messages = [{ role: "user", content: "ai sdk message" }];
      await exportSpans(exporter, [
        makeSpan({
          attributes: {
            "ai.prompt.messages": JSON.stringify(messages),
            "breadcrumb.input": "my override",
          },
        }),
      ]);
      expect(getSpansBody(fetchMock)[0].input).toBe("my override");
    });

    it("breadcrumb.output overrides ai.response.text", async () => {
      await exportSpans(exporter, [
        makeSpan({
          attributes: {
            "ai.response.text": "ai sdk output",
            "breadcrumb.output": "my override",
          },
        }),
      ]);
      expect(getSpansBody(fetchMock)[0].output).toBe("my override");
    });

    it("breadcrumb.input_tokens overrides ai.usage.inputTokens", async () => {
      await exportSpans(exporter, [
        makeSpan({
          attributes: { "ai.usage.inputTokens": 999, "breadcrumb.input_tokens": 42 },
        }),
      ]);
      expect(getSpansBody(fetchMock)[0].input_tokens).toBe(42);
    });

    it("breadcrumb.span.type overrides AI SDK inferred type", async () => {
      await exportSpans(exporter, [
        makeSpan({
          name: "ai.toolCall",
          attributes: { "breadcrumb.span.type": "retrieval" },
        }),
      ]);
      expect(getSpansBody(fetchMock)[0].type).toBe("retrieval");
    });

    it("breadcrumb metadata keys override matching AI SDK telemetry metadata keys", async () => {
      await exportSpans(exporter, [
        makeSpan({
          attributes: {
            "ai.telemetry.metadata.env": "staging",
            "breadcrumb.meta.env": "production",
          },
        }),
      ]);
      expect(getSpansBody(fetchMock)[0].metadata?.env).toBe("production");
    });

    it("breadcrumb and AI SDK metadata keys are merged when non-overlapping", async () => {
      await exportSpans(exporter, [
        makeSpan({
          attributes: {
            "ai.telemetry.metadata.source": "vector-db",
            "breadcrumb.meta.score": "0.95",
          },
        }),
      ]);
      expect(getSpansBody(fetchMock)[0].metadata).toEqual({
        source: "vector-db",
        score: "0.95",
      });
    });

    it("resource.name is used as trace name when set", async () => {
      await exportSpans(exporter, [
        makeSpan({ name: "ai.generateText", attributes: { "resource.name": "my-agent" } }),
      ]);
      expect(getTracesBody(fetchMock).name).toBe("my-agent");
      expect(getSpansBody(fetchMock)[0].name).toBe("my-agent");
    });
  });

  // ── Error handling / silent failures ───────────────────────────────────────

  describe("error handling", () => {
    it("returns SUCCESS even when fetch throws a network error", async () => {
      fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
      const result = await exportSpans(exporter, [makeSpan()]);
      expect(result.code).toBe(ExportResultCode.SUCCESS);
    });

    it("does not throw when the backend is unreachable", async () => {
      fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
      await expect(exportSpans(exporter, [makeSpan()])).resolves.toBeDefined();
    });

    it("returns SUCCESS when fetch returns a non-2xx response", async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 500 });
      const result = await exportSpans(exporter, [makeSpan()]);
      expect(result.code).toBe(ExportResultCode.SUCCESS);
    });
  });
});
