import { generateText } from "ai";
import { eq, and } from "drizzle-orm";
import { db } from "../../shared/db/postgres.js";
import { traceSummaries } from "../../shared/db/schema.js";
import { getAiModel } from "../explore/ai-provider.js";
import { readonlyClickhouse } from "../../shared/db/clickhouse.js";
import { toStr } from "./helpers.js";
import { createLogger } from "../../shared/lib/logger.js";

const log = createLogger("trace-analyze");

// ── Span serialisation ─────────────────────────────────────────────────────

interface RawSpan {
  id: string;
  parent_span_id: string;
  name: string;
  type: string;
  status: string;
  status_message: string;
  start_time: string;
  end_time: string;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  input_cost_usd: number;
  output_cost_usd: number;
  input: unknown;
  output: unknown;
  metadata: unknown;
}

const MAX_FIELD_CHARS = 800;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + `\n... (truncated, ${text.length} chars total)`;
}

function durationMs(start: string, end: string): number {
  return new Date(end).getTime() - new Date(start).getTime();
}

function formatSpanForPrompt(span: RawSpan, index: number): string {
  const dur = durationMs(span.start_time, span.end_time);
  const inputCost = Number(span.input_cost_usd) / 1_000_000;
  const outputCost = Number(span.output_cost_usd) / 1_000_000;
  const totalCost = inputCost + outputCost;

  const lines = [
    `--- SPAN ${index + 1} ---`,
    `ID: ${span.id}`,
    `Name: ${span.name}`,
    `Type: ${span.type}`,
    `Status: ${span.status}${span.status_message ? ` — ${span.status_message}` : ""}`,
    `Duration: ${dur}ms`,
    `Parent: ${span.parent_span_id || "(root)"}`,
  ];

  if (span.model) lines.push(`Model: ${span.model}`);
  if (span.provider) lines.push(`Provider: ${span.provider}`);
  if (Number(span.input_tokens) > 0 || Number(span.output_tokens) > 0) {
    lines.push(`Tokens: ${span.input_tokens} in / ${span.output_tokens} out`);
  }
  if (totalCost > 0) {
    lines.push(`Cost: $${totalCost.toFixed(6)}`);
  }

  const inputStr = toStr(span.input);
  const outputStr = toStr(span.output);
  const metadataStr = toStr(span.metadata);

  if (inputStr) {
    lines.push(`Input:\n${truncate(inputStr, MAX_FIELD_CHARS)}`);
  }
  if (outputStr) {
    lines.push(`Output:\n${truncate(outputStr, MAX_FIELD_CHARS)}`);
  }
  if (metadataStr && metadataStr !== "{}" && metadataStr !== "null") {
    lines.push(`Metadata:\n${truncate(metadataStr, MAX_FIELD_CHARS)}`);
  }

  return lines.join("\n");
}

// ── System prompt ──────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are analyzing an LLM application trace. Produce a concise, structured markdown summary that helps a developer quickly understand what happened and spot issues.

SCOPE:
Focus on the **application-level AI behavior** — what the agent/chain did, whether it achieved its goal, and whether the LLM calls were effective. Do NOT report on telemetry instrumentation details, span structure, or how tokens are reported across parent vs child spans — these are internal SDK concerns, not application issues.

FORMAT RULES:
- Start with a one-sentence overview of what this trace does.
- Use ## headings to organize into these sections (omit a section if not applicable):
  - **Overview** — What the trace does in 1-2 sentences.
  - **Flow** — The sequence of key steps. Use a numbered list. Reference specific spans.
  - **Issues** — Problems in the AI application logic. Focus on: LLM errors or refusals, tool call failures, reasoning loops or redundant calls, poor prompt quality leading to bad outputs, agent getting stuck or producing incorrect results. Do NOT flag telemetry/instrumentation quirks like token aggregation across span hierarchies.
  - **Performance** — Token usage, cost breakdown, latency observations. Report the actual token/cost numbers shown on individual spans. Do not speculate about double-counting or how parent spans aggregate child data — that is handled by the platform.
- When referencing a specific span, link to it as: [span name](#span:<spanId>)
  For example: [search-docs](#span:abc123def456)
- Keep the summary under ~400 words. Be direct and useful — no filler.
- Do NOT wrap the output in a code fence. Output raw markdown only.
- Do NOT include a title/h1 — the UI already shows the trace name.`;

// ── Max spans to include ───────────────────────────────────────────────────

const MAX_SPANS = 200;

// ── Main analysis function ─────────────────────────────────────────────────

export async function analyzeTrace(
  projectId: string,
  traceId: string,
): Promise<void> {
  log.info({ projectId, traceId }, "starting trace analysis");

  try {
    // Update status to running
    await db
      .update(traceSummaries)
      .set({ status: "running", errorMessage: null, updatedAt: new Date() })
      .where(
        and(
          eq(traceSummaries.projectId, projectId),
          eq(traceSummaries.traceId, traceId),
        ),
      );

    // Fetch spans from ClickHouse
    const result = await readonlyClickhouse.query({
      query: `
        SELECT
          id, parent_span_id, name, type, status, status_message,
          start_time, end_time, provider, model,
          input_tokens, output_tokens, input_cost_usd, output_cost_usd,
          input, output, metadata
        FROM breadcrumb.spans
        WHERE project_id = {projectId: UUID}
          AND trace_id = {traceId: String}
        ORDER BY start_time ASC
      `,
      query_params: { projectId, traceId },
      format: "JSONEachRow",
    });
    const spans = (await result.json()) as RawSpan[];

    if (spans.length === 0) {
      await db
        .update(traceSummaries)
        .set({
          status: "error",
          errorMessage: "No spans found for this trace",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(traceSummaries.projectId, projectId),
            eq(traceSummaries.traceId, traceId),
          ),
        );
      return;
    }

    // Build the prompt with span data
    const truncated = spans.length > MAX_SPANS;
    const spansToSend = truncated ? spans.slice(0, MAX_SPANS) : spans;
    const spanText = spansToSend
      .map((s, i) => formatSpanForPrompt(s, i))
      .join("\n\n");

    const userPrompt = [
      `This trace has ${spans.length} spans.${truncated ? ` Showing first ${MAX_SPANS}.` : ""}`,
      "",
      spanText,
    ].join("\n");

    // Get AI model and generate
    const model = await getAiModel(projectId);

    const { text } = await generateText({
      model,
      system: SYSTEM_PROMPT,
      prompt: userPrompt,
      temperature: 0,
    });

    // Save the result
    await db
      .update(traceSummaries)
      .set({
        markdown: text,
        status: "done",
        errorMessage: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(traceSummaries.projectId, projectId),
          eq(traceSummaries.traceId, traceId),
        ),
      );

    log.info({ projectId, traceId }, "trace analysis complete");
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown error during analysis";
    log.error({ projectId, traceId, err }, "trace analysis failed");

    await db
      .update(traceSummaries)
      .set({
        status: "error",
        errorMessage: message,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(traceSummaries.projectId, projectId),
          eq(traceSummaries.traceId, traceId),
        ),
      )
      .catch(() => {}); // Don't let the error update itself fail
  }
}
