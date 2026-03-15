/**
 * Shared TypeScript types for ClickHouse trace/span query results.
 * These represent the camelCase objects returned after row mapping —
 * NOT the raw CH column names.
 */

// ── Trace types ──────────────────────────────────────────────────────────────

/** Trace as returned by tRPC list endpoints (simple String/Number conversions). */
export interface TraceListRow {
  id: string;
  name: string;
  status: "ok" | "error";
  statusMessage: string;
  startTime: string;
  endTime: string | null;
  userId: string;
  environment: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  spanCount: number;
}

/** Trace as returned by MCP endpoints (includes duration calc, UTC normalization). */
export interface McpTraceRow {
  id: string;
  name: string;
  status: string;
  statusMessage: string | null;
  startTime: string;
  endTime: string | null;
  durationMs: number | null;
  userId: string | null;
  environment: string | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  spanCount: number;
}

// ── Span types ───────────────────────────────────────────────────────────────

/** Span as returned by tRPC detail endpoints (simple String/Number conversions). */
export interface SpanListRow {
  id: string;
  parentSpanId: string;
  name: string;
  type: string;
  status: "ok" | "error";
  statusMessage: string;
  startTime: string;
  endTime: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  inputCostUsd: number;
  outputCostUsd: number;
  input: string;
  output: string;
  metadata: string;
}

/** Span as returned by MCP list_spans (no input/output, includes duration). */
export interface McpSpanListRow {
  id: string;
  traceId: string;
  parentSpanId: string | null;
  name: string;
  type: string;
  status: string;
  statusMessage: string | null;
  startTime: string;
  endTime: string;
  durationMs: number | null;
  provider: string | null;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  inputCostUsd: number;
  outputCostUsd: number;
  metadata: unknown;
}

/** Span as returned by MCP get_trace (includes truncated input/output). */
export interface McpSpanDetailRow extends McpSpanListRow {
  input: string | null;
  output: string | null;
}

/** Span as returned by MCP get_span (full input/output, no truncation). */
export interface McpSpanFullRow extends McpSpanListRow {
  input: string | null;
  output: string | null;
}
