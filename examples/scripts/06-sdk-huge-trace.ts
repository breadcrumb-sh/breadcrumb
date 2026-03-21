/**
 * 06-sdk-huge-trace — oversized nested trace for UI and load testing
 *
 * Generates a single very large trace with deep nesting, large prompts,
 * large inputs/outputs, and many child spans. Tunable via env vars:
 *
 *   HUGE_TOP_LEVEL_STEPS=8
 *   HUGE_NESTED_DEPTH=4
 *   HUGE_BRANCHES_PER_STEP=3
 *   HUGE_PROMPT_REPEAT=80
 *   HUGE_PAYLOAD_REPEAT=40
 *
 * Run: npm run sdk-huge-trace --workspace=examples
 */

import { init, type BreadcrumbSpan, type Message, type SpanOptions } from "@breadcrumb-sdk/core";
import { config, sleep } from "../config.js";
import { buildHugeTracePlan, type HugeTraceStep } from "./huge-trace-plan.js";
import { fitHugeSpanPayloadsForIngest } from "./huge-trace-payloads.js";

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer, received: ${raw}`);
  }

  return parsed;
}

function toMessages(step: HugeTraceStep): Message[] {
  return [
    { role: "system", content: step.prompt.system },
    { role: "user", content: step.prompt.user },
  ];
}

async function emitStep(
  bc: ReturnType<typeof init>,
  step: HugeTraceStep,
): Promise<void> {
  const spanOptions: SpanOptions = { type: step.type };

  await bc.span(step.id, async (span) => {
    const messages = toMessages(step);
    const payloads = fitHugeSpanPayloadsForIngest(step);

    span.set({
      input: payloads.input,
      output: payloads.output,
      model: step.type === "llm" ? "claude-opus-4-6" : undefined,
      provider: step.type === "llm" ? "anthropic" : undefined,
      input_tokens: Math.floor(
        (messages[0]!.content.length + messages[1]!.content.length + payloads.input.context.length) / 4,
      ),
      output_tokens: Math.floor(
        (payloads.output.result.length + payloads.output.evaluation.length) / 4,
      ),
      input_cost_usd:
        step.type === "llm"
          ? Number(
              (
                (messages[0]!.content.length + messages[1]!.content.length + payloads.input.context.length) /
                1_000_000
              ).toFixed(6),
            )
          : undefined,
      output_cost_usd:
        step.type === "llm"
          ? Number(((payloads.output.result.length + payloads.output.evaluation.length) / 1_000_000).toFixed(6))
          : undefined,
      metadata: payloads.metadata,
    });

    if (step.type === "tool") {
      await bc.span("tool-stdout", async (toolSpan) => {
        toolSpan.set({
          input: { command: "huge-transform", args: ["--mode", "stress"] },
          output: {
            stdout: payloads.output.result,
            stderr: "",
          },
          metadata: {
            parent_step: step.id,
            stream: "stdout",
          },
        });
      }, { type: "tool" });
    }

    if (step.type === "retrieval") {
      await bc.span("retrieved-documents", async (retrievalSpan) => {
        retrievalSpan.set({
          input: { query: step.prompt.user.slice(0, 1_000) },
          output: {
            hits: step.input.attachments.map((attachment) => ({
              id: attachment.id,
              snippet: attachment.content.slice(0, 1_500),
            })),
          },
          metadata: {
            parent_step: step.id,
            hits: String(step.input.attachments.length),
          },
        });
      }, { type: "retrieval" });
    }

    await sleep(5);
    for (const child of step.children) {
      await emitStep(bc, child);
    }
  }, spanOptions);
}

const bc = init({
  ...config,
  batching: false,
});

const plan = buildHugeTracePlan({
  topLevelSteps: readPositiveInt("HUGE_TOP_LEVEL_STEPS", 8),
  nestedDepth: readPositiveInt("HUGE_NESTED_DEPTH", 4),
  branchesPerStep: readPositiveInt("HUGE_BRANCHES_PER_STEP", 3),
  promptRepeat: readPositiveInt("HUGE_PROMPT_REPEAT", 80),
  payloadRepeat: readPositiveInt("HUGE_PAYLOAD_REPEAT", 40),
});

await bc.trace("huge-load-test-trace", async (root: BreadcrumbSpan) => {
  root.set({
    input: {
      prompt: plan.rootInput,
      execution_mode: "ui-load-test",
      expected_span_count: plan.totalSpanCount,
    },
    metadata: {
      scenario: "huge-trace",
      top_level_steps: String(plan.steps.length),
      total_span_count: String(plan.totalSpanCount),
      nested_depth: String(readPositiveInt("HUGE_NESTED_DEPTH", 4)),
      branches_per_step: String(readPositiveInt("HUGE_BRANCHES_PER_STEP", 3)),
    },
  });

  for (const step of plan.steps) {
    await emitStep(bc, step);
  }

  root.set({
    output: {
      summary: plan.rootOutput.summary,
      artifact_digest: plan.rootOutput.artifactDigest,
    },
    metadata: {
      final_status: "complete",
      root_output_chars: String(plan.rootOutput.summary.length),
    },
  });
});

console.log(
  `huge trace sent: ${plan.totalSpanCount} spans across ${plan.steps.length} top-level steps`,
);
