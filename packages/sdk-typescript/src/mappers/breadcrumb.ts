import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import type { MappedSpanData, SpanType } from "./types.js";
import { tryJson, strAttr, intAttr, floatAttr } from "./utils.js";

const VALID_TYPES = new Set<string>(["llm", "tool", "retrieval", "step", "custom"]);

export function mapBreadcrumb(span: ReadableSpan): Partial<MappedSpanData> {
  const attrs = span.attributes;
  const result: Partial<MappedSpanData> = {};

  // ── Type override ─────────────────────────────────────────────────────────
  const explicitType = attrs["breadcrumb.span.type"];
  if (typeof explicitType === "string" && VALID_TYPES.has(explicitType)) {
    result.type = explicitType as SpanType;
  }

  // ── Input ─────────────────────────────────────────────────────────────────
  const rawInput = attrs["breadcrumb.input"];
  if (rawInput != null) {
    result.input =
      typeof rawInput === "string" ? (tryJson(rawInput) ?? rawInput) : rawInput;
  }

  // ── Output ────────────────────────────────────────────────────────────────
  const rawOutput = attrs["breadcrumb.output"];
  if (rawOutput != null) {
    result.output =
      typeof rawOutput === "string" ? (tryJson(rawOutput) ?? rawOutput) : rawOutput;
  }

  // ── Model / provider ──────────────────────────────────────────────────────
  const model = strAttr(attrs, "breadcrumb.model");
  if (model) result.model = model;

  const provider = strAttr(attrs, "breadcrumb.provider");
  if (provider) result.provider = provider;

  // ── Tokens ────────────────────────────────────────────────────────────────
  const input_tokens = intAttr(attrs, "breadcrumb.input_tokens");
  if (input_tokens != null) result.input_tokens = input_tokens;

  const output_tokens = intAttr(attrs, "breadcrumb.output_tokens");
  if (output_tokens != null) result.output_tokens = output_tokens;

  // ── Cost ──────────────────────────────────────────────────────────────────
  const input_cost_usd = floatAttr(attrs, "breadcrumb.input_cost_usd");
  if (input_cost_usd != null) result.input_cost_usd = input_cost_usd;

  const output_cost_usd = floatAttr(attrs, "breadcrumb.output_cost_usd");
  if (output_cost_usd != null) result.output_cost_usd = output_cost_usd;

  // ── Metadata ──────────────────────────────────────────────────────────────
  const metadata: Record<string, string> = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k.startsWith("breadcrumb.meta.")) {
      metadata[k.slice("breadcrumb.meta.".length)] = String(v);
    }
  }
  if (Object.keys(metadata).length > 0) result.metadata = metadata;

  return result;
}
