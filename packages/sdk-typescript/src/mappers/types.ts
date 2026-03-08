export type SpanType = "llm" | "tool" | "retrieval" | "step" | "custom";

export interface MappedSpanData {
  name?: string;
  type?: SpanType;
  input?: unknown;
  output?: unknown;
  model?: string;
  provider?: string;
  input_tokens?: number;
  output_tokens?: number;
  input_cost_usd?: number;
  output_cost_usd?: number;
  metadata?: Record<string, string>;
}
