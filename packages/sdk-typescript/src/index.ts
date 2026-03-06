import {
  context,
  trace,
  ROOT_CONTEXT,
  SpanStatusCode,
  type Span as OtelSpan,
} from "@opentelemetry/api";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import {
  SimpleSpanProcessor,
  BatchSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { BreadcrumbSpanExporter } from "./exporter.js";
import type { Breadcrumb, BreadcrumbSpan, SpanOptions } from "./types.js";

export type { Breadcrumb, BreadcrumbSpan, SpanOptions };

export interface InitOptions {
  apiKey: string;
  baseUrl: string;
  batching?:
    | false
    | {
        flushInterval?: number;
        maxBatchSize?: number;
      };
}

export function init(options: InitOptions): Breadcrumb {
  const exporter = new BreadcrumbSpanExporter(options.apiKey, options.baseUrl);

  const batchOpts =
    typeof options.batching === "object" ? options.batching : undefined;

  const processor =
    options.batching === false
      ? new SimpleSpanProcessor(exporter)
      : new BatchSpanProcessor(exporter, {
          scheduledDelayMillis: batchOpts?.flushInterval ?? 5000,
          maxExportBatchSize: batchOpts?.maxBatchSize ?? 100,
        });

  const provider = new NodeTracerProvider({ spanProcessors: [processor] });
  provider.register();

  process.once("beforeExit", async () => {
    await provider.shutdown().catch(() => {});
  });

  const tracer = provider.getTracer("@breadcrumb-sdk/core");

  function runSpan<T>(
    otelSpan: OtelSpan,
    activeCtx: typeof ROOT_CONTEXT,
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

    return context.with(trace.setSpan(activeCtx, otelSpan), async () => {
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
      const otelSpan = tracer.startSpan(name, {}, ROOT_CONTEXT);
      return runSpan(otelSpan, ROOT_CONTEXT, fn);
    },

    span<T>(
      name: string,
      fn: (span: BreadcrumbSpan) => Promise<T>,
      options?: SpanOptions,
    ): Promise<T> {
      const activeCtx = context.active();
      const otelSpan = tracer.startSpan(name, {}, activeCtx);
      if (options?.type) {
        otelSpan.setAttribute("breadcrumb.span.type", options.type);
      }
      return runSpan(otelSpan, activeCtx, fn);
    },
  };
}
