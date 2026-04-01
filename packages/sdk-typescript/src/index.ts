import {
  trace as traceApi,
  context as contextApi,
  ROOT_CONTEXT,
  SpanStatusCode,
  type Span as OtelSpan,
} from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  BasicTracerProvider,
  SimpleSpanProcessor,
  BatchSpanProcessor,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { BreadcrumbSpanExporter, SpanIdTracker } from "./exporter.js";
import type { Breadcrumb, BreadcrumbSpan, SpanOptions, SpanData, Message, SpanPayload, BeforeSendHook } from "./types.js";

export type { Breadcrumb, BreadcrumbSpan, SpanOptions, SpanData, Message, SpanPayload, BeforeSendHook };

export interface InitOptions {
  apiKey: string;
  baseUrl: string;
  environment?: string;
  batching?:
    | false
    | {
        flushInterval?: number;
        maxBatchSize?: number;
      };
  /**
   * Called for each span before it is sent to the Breadcrumb API.
   * Use this to redact PII, filter spans, or enrich metadata client-side.
   * Return the (possibly modified) payload, or `null` to drop the span entirely.
   */
  beforeSend?: BeforeSendHook;
}

// Track the active provider so we can clean up on re-init and avoid
// accumulating process exit handlers.
let activeProvider: BasicTracerProvider | null = null;
let exitHandlerRegistered = false;
let contextManagerRegistered = false;

export function init(options: InitOptions): Breadcrumb {
  if (!options.apiKey) {
    throw new Error("Breadcrumb SDK: apiKey is required");
  }
  if (!options.baseUrl) {
    throw new Error("Breadcrumb SDK: baseUrl is required");
  }

  try {
    new URL(options.baseUrl);
  } catch {
    throw new Error(`Breadcrumb SDK: baseUrl is not a valid URL: ${options.baseUrl}`);
  }

  // Shut down previous provider if init() is called multiple times
  if (activeProvider) {
    activeProvider.shutdown().catch(() => {});
    activeProvider = null;
  }

  // Ensure a context manager exists so context.with() / context.active()
  // work for span nesting. If Sentry or another tool already registered one,
  // setGlobalContextManager returns false and we use theirs — both are
  // AsyncLocalStorage-based and functionally compatible.
  if (!contextManagerRegistered) {
    contextManagerRegistered = true;
    const cm = new AsyncLocalStorageContextManager();
    cm.enable();
    contextApi.setGlobalContextManager(cm);
    // Returns false if already set — that's fine, we'll use the existing one.
  }

  const tracker = new SpanIdTracker();
  const exporter = new BreadcrumbSpanExporter(
    options.apiKey,
    options.baseUrl,
    options.environment,
    undefined,
    tracker,
    options.beforeSend,
  );

  const batchOpts =
    typeof options.batching === "object" ? options.batching : undefined;

  const exportProcessor =
    options.batching === false
      ? new SimpleSpanProcessor(exporter)
      : new BatchSpanProcessor(exporter, {
          scheduledDelayMillis: batchOpts?.flushInterval ?? 5000,
          maxExportBatchSize: batchOpts?.maxBatchSize ?? 100,
        });

  // Registers span IDs on creation so the exporter can detect foreign parents
  // even when using SimpleSpanProcessor (which exports spans one at a time).
  const trackingProcessor: SpanProcessor = {
    onStart(span) { tracker.add(span.spanContext().spanId); },
    onEnd() {},
    shutdown() { return Promise.resolve(); },
    forceFlush() { return Promise.resolve(); },
  };

  const provider = new BasicTracerProvider({
    spanProcessors: [trackingProcessor, exportProcessor],
  });
  // Intentionally NOT calling provider.register() — we keep this provider
  // private to avoid conflicts with Sentry, Datadog, or any other OTel-based tool.
  activeProvider = provider;

  // Register the exit handler only once across all init() calls
  if (!exitHandlerRegistered) {
    exitHandlerRegistered = true;
    process.once("beforeExit", async () => {
      if (activeProvider) {
        await activeProvider.shutdown().catch(() => {});
        activeProvider = null;
      }
    });
  }

  const tracer = provider.getTracer("@breadcrumb-sdk/core");

  function runSpan<T>(
    otelSpan: OtelSpan,
    fn: (span: BreadcrumbSpan) => Promise<T>,
  ): Promise<T> {
    const bcSpan: BreadcrumbSpan = {
      set(data) {
        const { metadata, ...semantic } = data;
        for (const [key, value] of Object.entries(semantic)) {
          if (value == null) continue;
          const attrKey = `breadcrumb.${key}`;
          if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
            otelSpan.setAttribute(attrKey, value);
          } else {
            otelSpan.setAttribute(attrKey, JSON.stringify(value));
          }
        }
        if (metadata) {
          for (const [key, value] of Object.entries(metadata)) {
            if (value == null) continue;
            otelSpan.setAttribute(`breadcrumb.meta.${key}`, value);
          }
        }
      },
    };

    // Set our span as the active span in the global context. This allows:
    // - bc.span() to find its parent via contextApi.active()
    // - AI SDK's startActiveSpan to find our span as parent
    const ctx = traceApi.setSpan(contextApi.active(), otelSpan);
    return contextApi.with(ctx, async () => {
      try {
        const result = await fn(bcSpan);
        otelSpan.setStatus({ code: SpanStatusCode.OK });
        otelSpan.end();
        return result;
      } catch (err) {
        otelSpan.setStatus({
          code: SpanStatusCode.ERROR,
          message: err instanceof Error ? err.message : String(err),
        });
        otelSpan.end();
        throw err;
      }
    });
  }

  return {
    trace<T>(
      name: string,
      fn: (span: BreadcrumbSpan) => Promise<T>,
    ): Promise<T> {
      // Always create a root span from ROOT_CONTEXT — never picks up
      // foreign parents (e.g. Sentry active spans) from the global context.
      const otelSpan = tracer.startSpan(name, {}, ROOT_CONTEXT);
      return runSpan(otelSpan, fn);
    },

    span<T>(
      name: string,
      fn: (span: BreadcrumbSpan) => Promise<T>,
      options?: SpanOptions,
    ): Promise<T> {
      // Read parent from the global context — set by trace()/span()'s runSpan.
      // If a Sentry span happens to be the parent (no bc.trace() wrapper),
      // the SpanIdTracker in the exporter will strip the foreign parent.
      const otelSpan = tracer.startSpan(name, {}, contextApi.active());
      if (options?.type) {
        otelSpan.setAttribute("breadcrumb.span.type", options.type);
      }
      return runSpan(otelSpan, fn);
    },

    __provider: provider,
  };
}

/**
 * Creates a span processor that sends spans to the Breadcrumb API.
 * Use this when you want to add Breadcrumb to a shared OTel provider
 * alongside other tools (e.g. Langfuse).
 *
 * Wraps the export processor with ID tracking so cross-provider parents
 * (e.g. from Sentry) are detected correctly regardless of batching mode.
 */
export function createBreadcrumbSpanProcessor(options: {
  apiKey: string;
  baseUrl: string;
  environment?: string;
  batching?: false | { flushInterval?: number; maxBatchSize?: number };
  beforeSend?: BeforeSendHook;
}): SpanProcessor {
  const tracker = new SpanIdTracker();
  const exporter = new BreadcrumbSpanExporter(
    options.apiKey,
    options.baseUrl,
    options.environment,
    undefined,
    tracker,
    options.beforeSend,
  );

  const inner: SpanProcessor =
    options.batching === false
      ? new SimpleSpanProcessor(exporter)
      : new BatchSpanProcessor(exporter, {
          scheduledDelayMillis:
            typeof options.batching === "object"
              ? options.batching.flushInterval ?? 5000
              : 5000,
          maxExportBatchSize:
            typeof options.batching === "object"
              ? options.batching.maxBatchSize ?? 100
              : 100,
        });

  // Composite processor: tracks IDs on start, delegates everything else
  return {
    onStart(span, parentContext) {
      tracker.add(span.spanContext().spanId);
      inner.onStart(span, parentContext);
    },
    onEnd(span) {
      inner.onEnd(span);
    },
    shutdown() {
      return inner.shutdown();
    },
    forceFlush() {
      return inner.forceFlush();
    },
  };
}
