import type { ExportResult } from "@opentelemetry/core";
import { ExportResultCode } from "@opentelemetry/core";
import type { SpanExporter, ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { SpanStatusCode } from "@opentelemetry/api";

type SpanType = "llm" | "tool" | "retrieval" | "step" | "custom";

// AI SDK span names that map to specific breadcrumb types
const LLM_SPAN_NAMES = new Set([
  "ai.generateText",
  "ai.generateText.doGenerate",
  "ai.streamText",
  "ai.streamText.doStream",
  "ai.generateObject",
  "ai.generateObject.doGenerate",
  "ai.generateObject.doStream",
]);

const TOOL_SPAN_NAMES = new Set([
  "ai.toolCall",
  "ai.toolExecution",
  "ai.executeToolCall",
]);

function hrTimeToISO(hrTime: [number, number]): string {
  return new Date(hrTime[0] * 1000 + hrTime[1] / 1_000_000).toISOString();
}

function spanStatus(span: ReadableSpan): "ok" | "error" {
  return span.status.code === SpanStatusCode.ERROR ? "error" : "ok";
}

function strAttr(span: ReadableSpan, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const v = span.attributes[key];
    if (typeof v === "string" && v !== "") return v;
  }
  return undefined;
}

function numAttr(span: ReadableSpan, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const v = span.attributes[key];
    if (typeof v === "number") return Math.round(v);
  }
  return undefined;
}

function inferSpanType(span: ReadableSpan): SpanType {
  const explicit = span.attributes["breadcrumb.span.type"];
  if (typeof explicit === "string" && explicit !== "") {
    return explicit as SpanType;
  }
  if (LLM_SPAN_NAMES.has(span.name)) return "llm";
  if (TOOL_SPAN_NAMES.has(span.name)) return "tool";
  return "custom";
}

// Attributes we handle explicitly — everything else goes into metadata
const KNOWN_ATTRS = new Set([
  "breadcrumb.span.type",
  "ai.model.id",
  "ai.model.provider",
  "ai.usage.inputTokens",
  "ai.usage.promptTokens",
  "ai.usage.outputTokens",
  "ai.usage.completionTokens",
  "gen_ai.request.model",
  "gen_ai.system",
  "gen_ai.usage.input_tokens",
  "gen_ai.usage.output_tokens",
]);

export class BreadcrumbSpanExporter implements SpanExporter {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
  ) {}

  export(
    spans: ReadableSpan[],
    resultCallback: (result: ExportResult) => void,
  ): void {
    this._export(spans).then(
      () => resultCallback({ code: ExportResultCode.SUCCESS }),
      () => resultCallback({ code: ExportResultCode.SUCCESS }), // fail silently
    );
  }

  private async _export(spans: ReadableSpan[]): Promise<void> {
    try {
      const roots = spans.filter((s) => !s.parentSpanId);
      const spanPayloads = spans.map((s) => this._mapSpan(s));

      const sends: Promise<void>[] = roots.map((s) => this._sendTrace(s));
      if (spanPayloads.length > 0) {
        sends.push(this._post("/v1/spans", spanPayloads));
      }

      await Promise.all(sends);
    } catch {
      // Fail silently
    }
  }

  private _mapSpan(span: ReadableSpan) {
    const ctx = span.spanContext();

    const metadata: Record<string, string> = {};
    for (const [k, v] of Object.entries(span.attributes)) {
      if (!KNOWN_ATTRS.has(k) && v != null) {
        metadata[k] = String(v);
      }
    }

    return {
      id: ctx.spanId,
      trace_id: ctx.traceId,
      parent_span_id: span.parentSpanId || undefined,
      name: span.name,
      type: inferSpanType(span),
      start_time: hrTimeToISO(span.startTime),
      end_time: hrTimeToISO(span.endTime),
      status: spanStatus(span),
      status_message: span.status.message || undefined,
      provider: strAttr(span, "ai.model.provider", "gen_ai.system"),
      model: strAttr(span, "ai.model.id", "gen_ai.request.model"),
      input_tokens: numAttr(
        span,
        "ai.usage.inputTokens",
        "ai.usage.promptTokens",
        "gen_ai.usage.input_tokens",
      ),
      output_tokens: numAttr(
        span,
        "ai.usage.outputTokens",
        "ai.usage.completionTokens",
        "gen_ai.usage.output_tokens",
      ),
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    };
  }

  private async _sendTrace(span: ReadableSpan): Promise<void> {
    const ctx = span.spanContext();
    await this._post("/v1/traces", {
      id: ctx.traceId,
      name: span.name,
      start_time: hrTimeToISO(span.startTime),
      end_time: hrTimeToISO(span.endTime),
      status: spanStatus(span),
      status_message: span.status.message || undefined,
    });
  }

  private async _post(path: string, body: unknown): Promise<void> {
    try {
      await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch {
      // Fail silently — backend unreachable
    }
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }
}
