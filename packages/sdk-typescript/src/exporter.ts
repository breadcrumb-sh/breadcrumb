import type { ExportResult } from "@opentelemetry/core";
import { ExportResultCode } from "@opentelemetry/core";
import type { SpanExporter, ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { SpanStatusCode } from "@opentelemetry/api";

type SpanType = "llm" | "tool" | "retrieval" | "step" | "custom";

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

// Attributes handled explicitly — excluded from metadata pass-through
const HANDLED_ATTRS = new Set([
  // Breadcrumb native
  "breadcrumb.span.type",
  "breadcrumb.input",
  "breadcrumb.output",
  "breadcrumb.model",
  "breadcrumb.provider",
  "breadcrumb.input_tokens",
  "breadcrumb.output_tokens",
  "breadcrumb.input_cost_usd",
  "breadcrumb.output_cost_usd",
  // AI SDK - function id / display name
  "resource.name",
  // AI SDK - input/output
  "ai.prompt",
  "ai.prompt.messages",
  "ai.response.text",
  // AI SDK - model/provider
  "ai.model.id",
  "ai.model.provider",
  "ai.response.model",
  "gen_ai.request.model",
  "gen_ai.system",
  // AI SDK - tokens
  "ai.usage.inputTokens",
  "ai.usage.promptTokens",
  "ai.usage.outputTokens",
  "ai.usage.completionTokens",
  "gen_ai.usage.input_tokens",
  "gen_ai.usage.output_tokens",
  // AI SDK - cost source
  "ai.response.providerMetadata",
  // AI SDK - finish reason (renamed in metadata)
  "ai.response.finishReason",
]);

// Attributes to drop entirely
const DROP_ATTRS = new Set([
  "operation.name",
  "ai.operationId",
  "ai.telemetry.functionId",
  "gen_ai.response.finish_reasons",
  "gen_ai.response.id",
  "gen_ai.response.model",
  "ai.response.id",
  "ai.response.timestamp",
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

function intAttr(span: ReadableSpan, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const v = span.attributes[key];
    if (typeof v === "number") return Math.round(v);
  }
  return undefined;
}

function floatAttr(span: ReadableSpan, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const v = span.attributes[key];
    if (typeof v === "number") return v;
  }
  return undefined;
}

function tryJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

function inferSpanType(span: ReadableSpan): SpanType {
  const explicit = span.attributes["breadcrumb.span.type"];
  if (typeof explicit === "string" && explicit !== "") return explicit as SpanType;
  if (LLM_SPAN_NAMES.has(span.name)) return "llm";
  if (TOOL_SPAN_NAMES.has(span.name)) return "tool";
  return "custom";
}

function extractCost(
  span: ReadableSpan,
): { input_cost_usd?: number; output_cost_usd?: number } {
  const raw = span.attributes["ai.response.providerMetadata"];
  if (typeof raw !== "string") return {};
  try {
    const parsed = tryJson(raw) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== "object") return {};
    for (const providerData of Object.values(parsed)) {
      const usage = (providerData as Record<string, unknown>)?.usage as
        | Record<string, unknown>
        | undefined;
      if (!usage) continue;
      const totalCost = usage["cost"];
      if (typeof totalCost !== "number") continue;
      const prompt = typeof usage["promptTokens"] === "number" ? usage["promptTokens"] : 0;
      const completion =
        typeof usage["completionTokens"] === "number" ? usage["completionTokens"] : 0;
      const total = prompt + completion;
      if (total > 0) {
        return {
          input_cost_usd: totalCost * (prompt / total),
          output_cost_usd: totalCost * (completion / total),
        };
      }
      return { input_cost_usd: totalCost };
    }
  } catch {
    // ignore
  }
  return {};
}

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
    const attrs = span.attributes;

    // Use resource.name (= AI SDK functionId) as display name when set
    const name = strAttr(span, "resource.name") ?? span.name;

    // ── Input ────────────────────────────────────────────────────────────────
    let input: unknown;
    const bcInput = attrs["breadcrumb.input"];
    const aiMessages = attrs["ai.prompt.messages"];
    const aiPrompt = attrs["ai.prompt"];
    if (bcInput != null) {
      input = typeof bcInput === "string" ? (tryJson(bcInput) ?? bcInput) : bcInput;
    } else if (typeof aiMessages === "string") {
      // doGenerate span: fully formatted messages array sent to the model
      input = tryJson(aiMessages) ?? aiMessages;
    } else if (typeof aiPrompt === "string") {
      // generateText outer span: raw prompt object { prompt?, system?, messages? }
      // Normalize to a messages array so the UI renders it the same as doGenerate.
      const parsed = tryJson(aiPrompt) as Record<string, unknown> | null;
      if (parsed && typeof parsed === "object") {
        const messages: { role: string; content: unknown }[] = [];
        if (parsed["system"]) messages.push({ role: "system", content: parsed["system"] });
        if (Array.isArray(parsed["messages"])) {
          messages.push(...(parsed["messages"] as { role: string; content: unknown }[]));
        } else if (parsed["prompt"] !== undefined) {
          messages.push({ role: "user", content: parsed["prompt"] });
        }
        input = messages.length > 0 ? messages : parsed;
      } else {
        input = aiPrompt;
      }
    }

    // ── Output ───────────────────────────────────────────────────────────────
    let output: unknown;
    const bcOutput = attrs["breadcrumb.output"];
    const aiText = attrs["ai.response.text"];
    if (bcOutput != null) {
      output = typeof bcOutput === "string" ? (tryJson(bcOutput) ?? bcOutput) : bcOutput;
    } else if (typeof aiText === "string") {
      output = aiText;
    }

    // ── Model / provider ─────────────────────────────────────────────────────
    const model = strAttr(span, "breadcrumb.model", "ai.model.id", "ai.response.model", "gen_ai.request.model");
    const provider = strAttr(span, "breadcrumb.provider", "ai.model.provider", "gen_ai.system");

    // ── Tokens ───────────────────────────────────────────────────────────────
    const input_tokens = intAttr(
      span,
      "breadcrumb.input_tokens",
      "ai.usage.inputTokens",
      "ai.usage.promptTokens",
      "gen_ai.usage.input_tokens",
    );
    const output_tokens = intAttr(
      span,
      "breadcrumb.output_tokens",
      "ai.usage.outputTokens",
      "ai.usage.completionTokens",
      "gen_ai.usage.output_tokens",
    );

    // ── Cost ─────────────────────────────────────────────────────────────────
    let input_cost_usd = floatAttr(span, "breadcrumb.input_cost_usd");
    let output_cost_usd = floatAttr(span, "breadcrumb.output_cost_usd");
    if (input_cost_usd == null && output_cost_usd == null) {
      const cost = extractCost(span);
      input_cost_usd = cost.input_cost_usd;
      output_cost_usd = cost.output_cost_usd;
    }

    // ── Metadata ─────────────────────────────────────────────────────────────
    const metadata: Record<string, string> = {};
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null) continue;
      if (HANDLED_ATTRS.has(k) || DROP_ATTRS.has(k)) continue;
      if (k.startsWith("ai.settings.")) continue;
      if (k.startsWith("ai.request.headers.")) continue;
      if (k.startsWith("breadcrumb.")) {
        // breadcrumb.meta.* keys from span.set({ metadata: {...} })
        if (k.startsWith("breadcrumb.meta.")) {
          metadata[k.slice("breadcrumb.meta.".length)] = String(v);
        }
        continue;
      }
      if (k.startsWith("ai.telemetry.metadata.")) {
        metadata[k.slice("ai.telemetry.metadata.".length)] = String(v);
        continue;
      }
      if (k === "ai.response.finishReason") {
        metadata["finish_reason"] = String(v);
        continue;
      }
      metadata[k] = String(v);
    }

    return {
      id: ctx.spanId,
      trace_id: ctx.traceId,
      parent_span_id: span.parentSpanId || undefined,
      name,
      type: inferSpanType(span),
      start_time: hrTimeToISO(span.startTime),
      end_time: hrTimeToISO(span.endTime),
      status: spanStatus(span),
      status_message: span.status.message || undefined,
      input: input !== undefined ? input : undefined,
      output: output !== undefined ? output : undefined,
      provider,
      model,
      input_tokens,
      output_tokens,
      input_cost_usd,
      output_cost_usd,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    };
  }

  private async _sendTrace(span: ReadableSpan): Promise<void> {
    const ctx = span.spanContext();
    const name = strAttr(span, "resource.name") ?? span.name;
    await this._post("/v1/traces", {
      id: ctx.traceId,
      name,
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
