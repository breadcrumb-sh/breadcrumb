/** W3C Trace Context — 128-bit trace ID as 32-char lowercase hex. */
export type TraceId = string;

/** W3C Trace Context — 64-bit span ID as 16-char lowercase hex. */
export type SpanId = string;

export type SpanType = "llm" | "tool" | "retrieval" | "step" | "custom";
export type Status   = "ok" | "error";

/**
 * Payload sent to POST /v1/traces.
 *
 * The server accepts two calls per trace:
 *   1. trace.start() — id, name, start_time, optional metadata
 *   2. trace.end()   — same id + end_time, status, output
 *
 * ReplacingMergeTree(version) on the server keeps the highest-version row,
 * so the end() call wins for all fields it sets.
 */
export interface TracePayload {
  id:              TraceId;
  name:            string;
  /** ISO 8601, e.g. "2024-01-01T00:00:00.000Z" */
  start_time:      string;
  /** ISO 8601. Absent on start(), required on end(). */
  end_time?:       string;
  status?:         Status;
  status_message?: string;
  input?:          unknown;
  output?:         unknown;
  user_id?:        string;
  session_id?:     string;
  environment?:    string;
  tags?:           Record<string, string>;
}

/**
 * Payload sent to POST /v1/spans.
 *
 * Spans are immutable once sent — no versioning, no upserts.
 * Costs should be float USD; the server converts to micro-dollars for storage.
 */
export interface SpanPayload {
  id:               SpanId;
  trace_id:         TraceId;
  parent_span_id?:  SpanId;
  name:             string;
  type:             SpanType;
  /** ISO 8601 */
  start_time:       string;
  /** ISO 8601 */
  end_time:         string;
  status?:          Status;
  status_message?:  string;
  input?:           unknown;
  output?:          unknown;
  /** e.g. "anthropic", "openai" */
  provider?:        string;
  /** e.g. "claude-opus-4-6", "gpt-4o" */
  model?:           string;
  input_tokens?:    number;
  output_tokens?:   number;
  /** Float USD, e.g. 0.000123 */
  input_cost_usd?:  number;
  /** Float USD */
  output_cost_usd?: number;
  metadata?:        Record<string, string>;
}
