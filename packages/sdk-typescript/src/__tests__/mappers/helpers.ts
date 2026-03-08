import { SpanStatusCode, SpanKind } from "@opentelemetry/api";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";

function toHrTime(ms: number): [number, number] {
  return [Math.floor(ms / 1000), (ms % 1000) * 1_000_000];
}

export function makeSpan(
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
    traceId = "a".repeat(32),
    spanId = "b".repeat(16),
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
