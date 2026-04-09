import type { ExportResult } from "@opentelemetry/core";
import { ExportResultCode } from "@opentelemetry/core";
import type { SpanExporter, ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { SpanStatusCode } from "@opentelemetry/api";
import { mapAiSdk } from "./mappers/ai-sdk.js";
import { mapBreadcrumb } from "./mappers/breadcrumb.js";
import type { MappedSpanData } from "./mappers/types.js";
import type { BeforeSendHook, SpanPayload } from "./types.js";

// Attribute namespaces fully handled by mappers — excluded from the generic
// pass-through that collects remaining unknown attrs into metadata.
const MAPPER_NAMESPACES = ["ai.", "gen_ai.", "breadcrumb.", "resource.name"];


// Non-namespaced keys that should be dropped entirely (not in metadata).
// These come from AI SDK / OTel conventions and are not user-meaningful.
const GLOBAL_DROP = new Set(["operation.name"]);

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 1;

function hrTimeToISO(hrTime: [number, number]): string {
  return new Date(hrTime[0] * 1000 + hrTime[1] / 1_000_000).toISOString();
}

function spanStatus(span: ReadableSpan): "ok" | "error" {
  return span.status.code === SpanStatusCode.ERROR ? "error" : "ok";
}

function mergeMappers(span: ReadableSpan): MappedSpanData {
  const aiSdk = mapAiSdk(span);
  const bc = mapBreadcrumb(span);

  // breadcrumb (user-set) wins for all scalar fields; metadata is merged with
  // breadcrumb keys overriding matching AI SDK keys.
  return {
    ...aiSdk,
    ...bc,
    metadata:
      aiSdk.metadata || bc.metadata
        ? { ...aiSdk.metadata, ...bc.metadata }
        : undefined,
  };
}

// Collect attributes not handled by any mapper (unknown namespaces like
// "custom.key", bare keys like "score") into metadata as strings.
function passthroughMetadata(
  span: ReadableSpan,
  existing: Record<string, string> | undefined,
): Record<string, string> | undefined {
  const extra: Record<string, string> = {};
  for (const [k, v] of Object.entries(span.attributes)) {
    if (v == null) continue;
    const handled = MAPPER_NAMESPACES.some((ns) =>
      k === ns || k.startsWith(ns),
    );
    if (handled || GLOBAL_DROP.has(k)) continue;
    extra[k] = String(v);
  }
  if (Object.keys(extra).length === 0) return existing || undefined;
  return { ...extra, ...existing }; // existing (breadcrumb) still wins
}

const KNOWN_SPANS_CAP = 10_000;

/**
 * Tracks span IDs we've seen so we can detect cross-provider parents.
 * When a span's parentSpanId isn't in this set, the parent is from a foreign
 * provider (e.g. Sentry) and we treat the span as a trace root.
 *
 * Shared between the exporter and any code that needs to register IDs
 * early (e.g. on span start, before export).
 */
export class SpanIdTracker {
  private ids = new Set<string>();

  add(spanId: string) {
    if (this.ids.size >= KNOWN_SPANS_CAP) {
      // Drop oldest half (Set iterates in insertion order)
      const keep = new Set<string>();
      let i = 0;
      const half = KNOWN_SPANS_CAP / 2;
      for (const v of this.ids) {
        if (i++ >= half) keep.add(v);
      }
      this.ids = keep;
    }
    this.ids.add(spanId);
  }

  has(spanId: string): boolean {
    return this.ids.has(spanId);
  }
}

export class BreadcrumbSpanExporter implements SpanExporter {
  private inflight: Promise<void>[] = [];
  readonly tracker: SpanIdTracker;

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly environment?: string,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
    tracker?: SpanIdTracker,
    private readonly beforeSend?: BeforeSendHook,
  ) {
    this.tracker = tracker ?? new SpanIdTracker();
  }

  export(
    spans: ReadableSpan[],
    resultCallback: (result: ExportResult) => void,
  ): void {
    const p = this._export(spans);
    this.inflight.push(p);
    p.finally(() => {
      this.inflight = this.inflight.filter((x) => x !== p);
    });
    p.then(
      () => resultCallback({ code: ExportResultCode.SUCCESS }),
      () => resultCallback({ code: ExportResultCode.FAILED }),
    );
  }

  private isOwnSpan(parentSpanId: string | undefined): boolean {
    return !!parentSpanId && this.tracker.has(parentSpanId);
  }

  private async _export(spans: ReadableSpan[]): Promise<void> {
    // Register span IDs (may already be registered via onStart, but
    // this ensures coverage for spans from external providers using
    // createBreadcrumbSpanProcessor without the tracking wrapper).
    for (const s of spans) {
      this.tracker.add(s.spanContext().spanId);
    }

    // A span is a trace root if it has no parent or its parent is from a
    // foreign provider (not in our known set).
    const roots = spans.filter(
      (s) => !s.parentSpanId || !this.isOwnSpan(s.parentSpanId),
    );

    // Map spans and apply beforeSend hook (may transform or drop spans)
    let spanPayloads: SpanPayload[] = spans.map((s) => this._mapSpan(s));
    if (this.beforeSend) {
      const processed: SpanPayload[] = [];
      for (const payload of spanPayloads) {
        try {
          const result = await this.beforeSend(payload);
          if (result !== null) processed.push(result);
        } catch {
          // Hook error — send original payload rather than dropping data
          processed.push(payload);
        }
      }
      spanPayloads = processed;
    }

    const sends: Promise<void>[] = roots.map((s) => this._sendTrace(s));
    if (spanPayloads.length > 0) {
      sends.push(this._post("/v1/spans", spanPayloads));
    }

    await Promise.all(sends);
  }

  private _mapSpan(span: ReadableSpan) {
    const ctx = span.spanContext();
    const mapped = mergeMappers(span);
    const metadata = passthroughMetadata(span, mapped.metadata);

    // Only include parent_span_id if the parent is one of our own spans.
    // Foreign parents (e.g. from Sentry) are stripped to avoid orphaned references.
    const parentSpanId = this.isOwnSpan(span.parentSpanId)
      ? span.parentSpanId
      : undefined;

    return {
      id: ctx.spanId,
      trace_id: ctx.traceId,
      parent_span_id: parentSpanId,
      name: mapped.name ?? span.name,
      type: mapped.type ?? "custom",
      start_time: hrTimeToISO(span.startTime),
      end_time: hrTimeToISO(span.endTime),
      status: spanStatus(span),
      status_message: span.status.message || undefined,
      input: mapped.input !== undefined ? mapped.input : undefined,
      output: mapped.output !== undefined ? mapped.output : undefined,
      provider: mapped.provider,
      model: mapped.model,
      input_tokens: mapped.input_tokens,
      output_tokens: mapped.output_tokens,
      cached_input_tokens: mapped.cached_input_tokens,
      cache_creation_input_tokens: mapped.cache_creation_input_tokens,
      reasoning_tokens: mapped.reasoning_tokens,
      input_cost_usd: mapped.input_cost_usd,
      output_cost_usd: mapped.output_cost_usd,
      metadata: metadata && Object.keys(metadata).length > 0 ? metadata : undefined,
    };
  }

  private async _sendTrace(span: ReadableSpan): Promise<void> {
    const ctx = span.spanContext();
    const mapped = mergeMappers(span);
    await this._post("/v1/traces", {
      id: ctx.traceId,
      name: mapped.name ?? span.name,
      start_time: hrTimeToISO(span.startTime),
      end_time: hrTimeToISO(span.endTime),
      status: spanStatus(span),
      status_message: span.status.message || undefined,
      environment: this.environment,
    });
  }

  private async _post(path: string, body: unknown): Promise<void> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
          const res = await fetch(`${this.baseUrl}${path}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify(body),
            signal: controller.signal,
          });
          if (res.ok) return;
          // Server error — retry if we have attempts left
          if (attempt < MAX_RETRIES) continue;
        } finally {
          clearTimeout(timer);
        }
      } catch {
        // Network error or timeout — retry if we have attempts left
        if (attempt < MAX_RETRIES) continue;
      }
    }
  }

  shutdown(): Promise<void> {
    return this.forceFlush();
  }

  forceFlush(): Promise<void> {
    return Promise.all(this.inflight).then(() => {});
  }
}
