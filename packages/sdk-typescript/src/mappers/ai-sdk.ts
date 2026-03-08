import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import type { MappedSpanData, SpanType } from "./types.js";
import { tryJson, strAttr, intAttr, floatAttr } from "./utils.js";

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

// Attributes extracted into first-class fields — excluded from metadata pass-through
const HANDLED = new Set([
  "resource.name",
  "ai.prompt",
  "ai.prompt.messages",
  "ai.response.text",
  "ai.response.toolCalls",
  "ai.toolCall.name",
  "ai.toolCall.args",
  "ai.toolCall.result",
  "ai.model.id",
  "ai.model.provider",
  "ai.response.model",
  "gen_ai.request.model",
  "gen_ai.system",
  "ai.usage.inputTokens",
  "ai.usage.promptTokens",
  "ai.usage.outputTokens",
  "ai.usage.completionTokens",
  "gen_ai.usage.input_tokens",
  "gen_ai.usage.output_tokens",
  "ai.response.providerMetadata",
  "ai.response.finishReason",
  // Metadata with prefix stripped — handled in the metadata loop below
  // (ai.telemetry.metadata.*)
]);

// Attributes to drop entirely (not extracted, not in metadata)
const DROP = new Set([
  "operation.name",
  "ai.operationId",
  "ai.telemetry.functionId",
  "gen_ai.response.finish_reasons",
  "gen_ai.response.id",
  "gen_ai.response.model",
  "ai.response.id",
  "ai.response.timestamp",
  "ai.prompt.tools",
  "ai.prompt.toolChoice",
  "ai.toolCall.id",
]);

function inferType(spanName: string): SpanType {
  if (LLM_SPAN_NAMES.has(spanName)) return "llm";
  if (TOOL_SPAN_NAMES.has(spanName)) return "tool";
  return "custom";
}

function extractCost(
  raw: string,
): { input_cost_usd?: number; output_cost_usd?: number } {
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

export function mapAiSdk(span: ReadableSpan): Partial<MappedSpanData> {
  const attrs = span.attributes;
  const result: Partial<MappedSpanData> = {};

  // ── Name ─────────────────────────────────────────────────────────────────
  const toolCallName = strAttr(attrs, "ai.toolCall.name");
  const resourceName = strAttr(attrs, "resource.name");
  if (toolCallName) result.name = toolCallName;
  else if (resourceName) result.name = resourceName;

  // ── Type ─────────────────────────────────────────────────────────────────
  result.type = inferType(span.name);

  // ── Input ─────────────────────────────────────────────────────────────────
  const toolArgs = attrs["ai.toolCall.args"];
  const aiMessages = attrs["ai.prompt.messages"];
  const aiPrompt = attrs["ai.prompt"];

  if (typeof toolArgs === "string") {
    result.input = tryJson(toolArgs) ?? toolArgs;
  } else if (typeof aiMessages === "string") {
    result.input = tryJson(aiMessages) ?? aiMessages;
  } else if (typeof aiPrompt === "string") {
    const parsed = tryJson(aiPrompt) as Record<string, unknown> | null;
    if (parsed && typeof parsed === "object") {
      const messages: { role: string; content: unknown }[] = [];
      if (parsed["system"]) messages.push({ role: "system", content: parsed["system"] });
      if (Array.isArray(parsed["messages"])) {
        messages.push(...(parsed["messages"] as { role: string; content: unknown }[]));
      } else if (parsed["prompt"] !== undefined) {
        messages.push({ role: "user", content: parsed["prompt"] });
      }
      result.input = messages.length > 0 ? messages : parsed;
    } else {
      result.input = aiPrompt;
    }
  }

  // ── Output ────────────────────────────────────────────────────────────────
  const toolResult = attrs["ai.toolCall.result"];
  const aiText = attrs["ai.response.text"];
  const aiToolCalls = attrs["ai.response.toolCalls"];

  if (typeof toolResult === "string") {
    result.output = tryJson(toolResult) ?? toolResult;
  } else if (typeof aiText === "string") {
    result.output = aiText;
  } else if (typeof aiToolCalls === "string") {
    const parsed = tryJson(aiToolCalls);
    if (Array.isArray(parsed)) {
      result.output = parsed.map((tc: Record<string, unknown>) => ({
        ...tc,
        input:
          typeof tc["input"] === "string"
            ? (tryJson(tc["input"]) ?? tc["input"])
            : tc["input"],
      }));
    } else {
      result.output = parsed ?? aiToolCalls;
    }
  }

  // ── Model / provider ──────────────────────────────────────────────────────
  const model = strAttr(attrs, "ai.model.id", "ai.response.model", "gen_ai.request.model");
  if (model) result.model = model;

  const provider = strAttr(attrs, "ai.model.provider", "gen_ai.system");
  if (provider) result.provider = provider;

  // ── Tokens ────────────────────────────────────────────────────────────────
  const input_tokens = intAttr(
    attrs,
    "ai.usage.inputTokens",
    "ai.usage.promptTokens",
    "gen_ai.usage.input_tokens",
  );
  if (input_tokens != null) result.input_tokens = input_tokens;

  const output_tokens = intAttr(
    attrs,
    "ai.usage.outputTokens",
    "ai.usage.completionTokens",
    "gen_ai.usage.output_tokens",
  );
  if (output_tokens != null) result.output_tokens = output_tokens;

  // ── Cost ──────────────────────────────────────────────────────────────────
  const providerMeta = attrs["ai.response.providerMetadata"];
  if (typeof providerMeta === "string") {
    const cost = extractCost(providerMeta);
    if (cost.input_cost_usd != null) result.input_cost_usd = cost.input_cost_usd;
    if (cost.output_cost_usd != null) result.output_cost_usd = cost.output_cost_usd;
  }

  // ── Cost from explicit breadcrumb attrs (none here — handled by mapBreadcrumb) ─

  // ── Metadata pass-through ─────────────────────────────────────────────────
  // Collect unrecognised ai.* / gen_ai.* attrs as metadata.
  const metadata: Record<string, string> = {};

  // ai.response.finishReason is in HANDLED (excluded from pass-through) but
  // still needs to appear in metadata under a clean key.
  const finishReason = attrs["ai.response.finishReason"];
  if (typeof finishReason === "string" && finishReason !== "") {
    metadata["finish_reason"] = finishReason;
  }

  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (HANDLED.has(k) || DROP.has(k)) continue;
    if (k.startsWith("ai.settings.") || k.startsWith("ai.request.headers.")) continue;

    if (k.startsWith("ai.telemetry.metadata.")) {
      metadata[k.slice("ai.telemetry.metadata.".length)] = String(v);
      continue;
    }
    // Only pass through ai.* and gen_ai.* here; other namespaces are handled
    // by the exporter's own pass-through for truly unknown attributes.
    if (k.startsWith("ai.") || k.startsWith("gen_ai.")) {
      metadata[k] = String(v);
    }
  }

  if (Object.keys(metadata).length > 0) result.metadata = metadata;

  return result;
}
