export { Breadcrumb } from "./breadcrumb.js";
export { Agent } from "./agent.js";
export { Timer } from "./timer.js";
export type {
  BreadcrumbOptions,
  AgentOptions,
  AgentEndOptions,
  TrackOptions,
  TimerEndOptions,
  Usage,
} from "./types.js";

// Re-export core primitives so users only need one import
export type {
  TraceId,
  SpanId,
  SpanType,
  Status,
  TracePayload,
  SpanPayload,
  IngestClientOptions,
} from "@breadcrumb/core";
export { generateTraceId, generateSpanId, IngestClient } from "@breadcrumb/core";
