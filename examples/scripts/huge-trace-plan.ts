interface HugeTracePlanOptions {
  topLevelSteps?: number;
  nestedDepth?: number;
  branchesPerStep?: number;
  promptRepeat?: number;
  payloadRepeat?: number;
}

interface HugePrompt {
  system: string;
  user: string;
}

interface HugePayload {
  context: string;
  attachments: Array<{
    id: string;
    mimeType: string;
    content: string;
  }>;
}

interface HugeResult {
  result: string;
  evaluation: string;
}

export interface HugeTraceStep {
  id: string;
  depth: number;
  type: "step" | "llm" | "tool" | "retrieval";
  prompt: HugePrompt;
  input: HugePayload;
  output: HugeResult;
  metadata: Record<string, string>;
  children: HugeTraceStep[];
}

export interface HugeTracePlan {
  rootInput: string;
  rootOutput: {
    summary: string;
    artifactDigest: string;
  };
  steps: HugeTraceStep[];
  totalSpanCount: number;
}

const DEFAULTS = {
  topLevelSteps: 8,
  nestedDepth: 4,
  branchesPerStep: 3,
  promptRepeat: 80,
  payloadRepeat: 40,
} satisfies Required<HugeTracePlanOptions>;

const STEP_TYPES: HugeTraceStep["type"][] = ["step", "llm", "tool", "retrieval"];

function repeatParagraph(label: string, seed: string, repeat: number): string {
  return Array.from({ length: repeat }, (_, index) =>
    `${label} ${index + 1}: ${seed} This section is intentionally verbose to stress rendering, storage, truncation, and scrolling behaviour across large trace payloads.`,
  ).join("\n\n");
}

function buildStep(
  id: string,
  depth: number,
  maxDepth: number,
  branchesPerStep: number,
  promptRepeat: number,
  payloadRepeat: number,
): HugeTraceStep {
  const stepLabel = `workflow ${id} at depth ${depth}`;
  const prompt: HugePrompt = {
    system: repeatParagraph(
      `System instructions for ${stepLabel}`,
      "Act as a load-test orchestration agent that documents every intermediate state, cites every artifact, and preserves full prompt context.",
      promptRepeat,
    ),
    user: repeatParagraph(
      `User request for ${stepLabel}`,
      "Generate a detailed reasoning bundle, include tool transcripts, retrieval evidence, and a full output artifact manifest.",
      promptRepeat,
    ),
  };

  const input: HugePayload = {
    context: repeatParagraph(
      `Input context for ${stepLabel}`,
      "Large structured context block with pseudo-documents, tool settings, and serialized memory intended to mimic oversized agent state.",
      payloadRepeat,
    ),
    attachments: Array.from({ length: 3 }, (_, index) => ({
      id: `${id}-attachment-${index + 1}`,
      mimeType: "application/json",
      content: repeatParagraph(
        `Attachment ${index + 1} for ${stepLabel}`,
        "Attached content contains serialized retrieval hits, prompt templates, and chain-of-thought-like placeholders for UI load testing.",
        Math.max(4, Math.floor(payloadRepeat / 2)),
      ),
    })),
  };

  const output: HugeResult = {
    result: repeatParagraph(
      `Output result for ${stepLabel}`,
      "The agent produced a long-form artifact with intermediate drafts, revision notes, confidence calls, and citations for each nested step.",
      payloadRepeat,
    ),
    evaluation: repeatParagraph(
      `Evaluation notes for ${stepLabel}`,
      "Post-processing checks validate schema compliance, compare variants, and score completeness for each generated section.",
      Math.max(4, Math.floor(payloadRepeat / 2)),
    ),
  };

  const children =
    depth >= maxDepth
      ? []
      : Array.from({ length: branchesPerStep }, (_, index) =>
          buildStep(
            `${id}.${index + 1}`,
            depth + 1,
            maxDepth,
            branchesPerStep,
            promptRepeat,
            payloadRepeat,
          ),
        );

  return {
    id,
    depth,
    type: STEP_TYPES[(depth - 1) % STEP_TYPES.length] ?? "step",
    prompt,
    input,
    output,
    metadata: {
      branch_count: String(children.length),
      prompt_chars: String(prompt.system.length + prompt.user.length),
      payload_chars: String(input.context.length + output.result.length),
      depth: String(depth),
    },
    children,
  };
}

function countSteps(steps: HugeTraceStep[]): number {
  return steps.reduce((sum, step) => sum + 1 + countSteps(step.children), 0);
}

export function buildHugeTracePlan(options: HugeTracePlanOptions = {}): HugeTracePlan {
  const {
    topLevelSteps,
    nestedDepth,
    branchesPerStep,
    promptRepeat,
    payloadRepeat,
  } = { ...DEFAULTS, ...options };

  const steps = Array.from({ length: topLevelSteps }, (_, index) =>
    buildStep(
      String(index + 1),
      1,
      nestedDepth,
      branchesPerStep,
      promptRepeat,
      payloadRepeat,
    ),
  );

  return {
    rootInput: repeatParagraph(
      "Root trace input",
      "Top-level agent run with a huge prompt, a large serialized scratchpad, and multiple execution branches intended to saturate the trace detail view.",
      promptRepeat,
    ),
    rootOutput: {
      summary: repeatParagraph(
        "Root trace summary",
        "Final response includes a merged artifact pack, QA notes, evaluator summaries, and branch-by-branch completion signals.",
        payloadRepeat,
      ),
      artifactDigest: steps
        .map((step) => `${step.id}:${step.type}:${step.metadata["payload_chars"]}`)
        .join(" | "),
    },
    steps,
    totalSpanCount: countSteps(steps),
  };
}
