import type { Message } from "@breadcrumb-sdk/core";
import type { HugeTraceStep } from "./huge-trace-plan.js";

const MAX_JSON_FIELD_LENGTH = 64 * 1024;
const TARGET_JSON_FIELD_LENGTH = 60 * 1024;
const ELLIPSIS = "\n\n[truncated for ingest limit]";

type HugeSpanPayloads = {
  input: {
    messages: Message[];
    context: string;
    attachments: HugeTraceStep["input"]["attachments"];
  };
  output: {
    result: string;
    evaluation: string;
  };
  metadata: Record<string, string>;
};

function trimString(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const keep = Math.max(0, maxLength - ELLIPSIS.length);
  return `${value.slice(0, keep)}${ELLIPSIS}`;
}

function trimToSerializedLimit<T>(value: T, shrink: (current: T) => T): T {
  let current = value;
  while (JSON.stringify(current).length > TARGET_JSON_FIELD_LENGTH) {
    const next = shrink(current);
    if (JSON.stringify(next).length >= JSON.stringify(current).length) {
      break;
    }
    current = next;
  }
  return current;
}

export function fitHugeSpanPayloadsForIngest(step: HugeTraceStep): HugeSpanPayloads {
  const baseInput = {
    messages: [
      { role: "system" as const, content: step.prompt.system },
      { role: "user" as const, content: step.prompt.user },
    ],
    context: step.input.context,
    attachments: step.input.attachments.map((attachment) => ({ ...attachment })),
  };

  const baseOutput = {
    result: step.output.result,
    evaluation: step.output.evaluation,
  };

  const input = trimToSerializedLimit(baseInput, (current) => ({
    messages: current.messages.map((message) => ({
      ...message,
      content: trimString(message.content, Math.floor(message.content.length * 0.8)),
    })),
    context: trimString(current.context, Math.floor(current.context.length * 0.8)),
    attachments: current.attachments.map((attachment) => ({
      ...attachment,
      content: trimString(attachment.content, Math.floor(attachment.content.length * 0.65)),
    })),
  }));

  const output = trimToSerializedLimit(baseOutput, (current) => ({
    result: trimString(current.result, Math.floor(current.result.length * 0.85)),
    evaluation: trimString(current.evaluation, Math.floor(current.evaluation.length * 0.85)),
  }));

  const metadata = {
    ...step.metadata,
    input_payload_chars: String(JSON.stringify(input).length),
    output_payload_chars: String(JSON.stringify(output).length),
    input_payload_trimmed: String(JSON.stringify(baseInput).length > JSON.stringify(input).length),
    output_payload_trimmed: String(JSON.stringify(baseOutput).length > JSON.stringify(output).length),
  };

  if (JSON.stringify(input).length > MAX_JSON_FIELD_LENGTH) {
    throw new Error(`Huge trace input still exceeds ${MAX_JSON_FIELD_LENGTH} characters after trimming`);
  }

  if (JSON.stringify(output).length > MAX_JSON_FIELD_LENGTH) {
    throw new Error(`Huge trace output still exceeds ${MAX_JSON_FIELD_LENGTH} characters after trimming`);
  }

  return { input, output, metadata };
}
