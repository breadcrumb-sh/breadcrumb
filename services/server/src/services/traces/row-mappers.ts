/**
 * Shared row-mapping functions that convert raw ClickHouse result rows
 * into typed, camelCase objects for tRPC and MCP consumers.
 *
 * No framework imports — pure functions only.
 */

import { calcDuration, toUtc, truncateSpanField, normMetadata } from "../mcp/helpers.js";
import { toStr } from "./helpers.js";
import type {
  TraceListRow,
  SpanListRow,
  McpTraceRow,
  McpSpanListRow,
  McpSpanDetailRow,
  McpSpanFullRow,
} from "./types.js";

// ── tRPC row mappers ─────────────────────────────────────────────────────────

/**
 * Map a CH row to a tRPC trace list object.
 * Simple String/Number conversions — no duration calc or UTC normalization.
 * Used by the tRPC `list` procedure.
 */
export function mapTraceListRow(r: Record<string, unknown>): TraceListRow {
  return {
    id:            String(r["id"]),
    name:          String(r["name"]),
    status:        String(r["status"]) as "ok" | "error",
    statusMessage: String(r["status_message"] ?? ""),
    startTime:     String(r["start_time"]),
    endTime:       r["end_time"] != null ? String(r["end_time"]) : null,
    userId:        String(r["user_id"] ?? ""),
    environment:   String(r["environment"] ?? ""),
    inputTokens:   Number(r["input_tokens"] ?? 0),
    outputTokens:  Number(r["output_tokens"] ?? 0),
    costUsd:       Number(r["cost_usd"] ?? 0) / 1_000_000,
    spanCount:     Number(r["span_count"] ?? 0),
  };
}

/**
 * Map a CH row to a tRPC span detail object.
 * Used by the tRPC `byId` / `spanSample` procedures.
 */
export function mapSpanListRow(r: Record<string, unknown>): SpanListRow {
  return {
    id:            String(r["id"]),
    parentSpanId:  String(r["parent_span_id"] ?? ""),
    name:          String(r["name"]),
    type:          String(r["type"]),
    status:        String(r["status"]) as "ok" | "error",
    statusMessage: String(r["status_message"] ?? ""),
    startTime:     String(r["start_time"]),
    endTime:       String(r["end_time"]),
    provider:      String(r["provider"] ?? ""),
    model:         String(r["model"] ?? ""),
    inputTokens:   Number(r["input_tokens"] ?? 0),
    outputTokens:  Number(r["output_tokens"] ?? 0),
    inputCostUsd:  Number(r["input_cost_usd"] ?? 0) / 1_000_000,
    outputCostUsd: Number(r["output_cost_usd"] ?? 0) / 1_000_000,
    input:         toStr(r["input"]),
    output:        toStr(r["output"]),
    metadata:      toStr(r["metadata"]),
  };
}

// ── MCP row mappers ──────────────────────────────────────────────────────────

/**
 * Map a CH row to an MCP trace object.
 * Includes UTC normalization, duration calculation, and null coalescing.
 * Used by MCP `list_traces` and `find_outliers`.
 */
export function mapMcpTraceRow(r: Record<string, unknown>): McpTraceRow {
  const startTime = toUtc(String(r["start_time"]))!;
  const endTime = toUtc(r["end_time"] != null ? String(r["end_time"]) : null);
  return {
    id:           String(r["id"]),
    name:         String(r["name"]),
    status:       String(r["status"]),
    statusMessage: String(r["status_message"] ?? "") || null,
    startTime,
    endTime,
    durationMs:   calcDuration(startTime, endTime),
    userId:       String(r["user_id"] ?? "") || null,
    environment:  String(r["environment"] ?? "") || null,
    inputTokens:  Number(r["input_tokens"] ?? 0),
    outputTokens: Number(r["output_tokens"] ?? 0),
    costUsd:      Number(r["cost_usd"] ?? 0) / 1_000_000,
    spanCount:    Number(r["span_count"] ?? 0),
  };
}

/**
 * Map a CH row to an MCP span list object (no input/output fields).
 * Includes UTC normalization, duration calculation, and metadata normalization.
 * Used by MCP `list_spans`.
 */
export function mapMcpSpanListRow(r: Record<string, unknown>): McpSpanListRow {
  const spanStart = toUtc(String(r["start_time"]))!;
  const spanEnd = toUtc(String(r["end_time"]))!;
  return {
    id:            String(r["id"]),
    traceId:       String(r["trace_id"]),
    parentSpanId:  String(r["parent_span_id"] ?? "") || null,
    name:          String(r["name"]),
    type:          String(r["type"]),
    status:        String(r["status"]),
    statusMessage: String(r["status_message"] ?? "") || null,
    startTime:     spanStart,
    endTime:       spanEnd,
    durationMs:    calcDuration(spanStart, spanEnd),
    provider:      String(r["provider"] ?? "") || null,
    model:         String(r["model"] ?? "") || null,
    inputTokens:   Number(r["input_tokens"] ?? 0),
    outputTokens:  Number(r["output_tokens"] ?? 0),
    inputCostUsd:  Number(r["input_cost_usd"] ?? 0) / 1_000_000,
    outputCostUsd: Number(r["output_cost_usd"] ?? 0) / 1_000_000,
    metadata:      normMetadata(r["metadata"]),
  };
}

/**
 * Map a CH row to an MCP span detail object (with truncated input/output).
 * Used by MCP `get_trace` for the embedded spans array.
 */
export function mapMcpSpanDetailRow(r: Record<string, unknown>): McpSpanDetailRow {
  const base = mapMcpSpanListRow(r);
  const input = String(r["input"] ?? "") || null;
  const output = String(r["output"] ?? "") || null;
  return {
    ...base,
    input:  truncateSpanField(input, "input"),
    output: truncateSpanField(output, "output"),
  };
}

/**
 * Map a CH row to an MCP span full object (no truncation on input/output).
 * Used by MCP `get_span` where the full content is desired.
 */
export function mapMcpSpanFullRow(r: Record<string, unknown>): McpSpanFullRow {
  const base = mapMcpSpanListRow(r);
  return {
    ...base,
    input:  String(r["input"] ?? "") || null,
    output: String(r["output"] ?? "") || null,
  };
}
