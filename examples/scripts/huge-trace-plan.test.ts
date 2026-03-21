import test from "node:test";
import assert from "node:assert/strict";
import { buildHugeTracePlan } from "./huge-trace-plan.js";
import { fitHugeSpanPayloadsForIngest } from "./huge-trace-payloads.js";

test("buildHugeTracePlan creates a large nested workload with prompt and payload content", () => {
  const plan = buildHugeTracePlan({
    topLevelSteps: 3,
    nestedDepth: 3,
    branchesPerStep: 2,
    promptRepeat: 12,
    payloadRepeat: 8,
  });

  assert.equal(plan.steps.length, 3);
  assert.equal(plan.totalSpanCount, 21);
  assert.ok(plan.rootInput.length > 500);
  assert.ok(plan.rootOutput.summary.length > 500);

  const first = plan.steps[0];
  assert.ok(first.prompt.system.length > 500);
  assert.ok(first.input.context.length > 500);
  assert.ok(first.output.result.length > 500);
  assert.equal(first.children.length, 2);
  assert.equal(first.children[0]?.children.length, 2);
});

test("fitHugeSpanPayloadsForIngest keeps generated span payloads below ingest limits", () => {
  const plan = buildHugeTracePlan();
  const first = plan.steps[0]!;

  const payloads = fitHugeSpanPayloadsForIngest(first);
  const inputLength = JSON.stringify(payloads.input).length;
  const outputLength = JSON.stringify(payloads.output).length;

  assert.ok(inputLength <= 64 * 1024, `expected input <= 65536, got ${inputLength}`);
  assert.ok(outputLength <= 64 * 1024, `expected output <= 65536, got ${outputLength}`);
  assert.ok(inputLength > 40_000, `expected large input payload, got ${inputLength}`);
  assert.ok(outputLength > 10_000, `expected large output payload, got ${outputLength}`);
});
