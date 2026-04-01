/**
 * A single message in a conversation. Pass an array of these as `input` to
 * display the conversation in the Breadcrumb UI the same way LLM spans appear.
 */
export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

export interface SpanData {
  /**
   * The input to this step. Use a plain string for simple inputs, or a
   * `Message[]` array for conversation-style inputs — the UI renders both
   * with role labels (system / user / assistant).
   * Any other JSON-serializable value is also accepted and shown as raw data.
   */
  input?: string | Message[] | Record<string, unknown>;
  /**
   * The output from this step. Use a plain string for text outputs.
   * Any JSON-serializable value is accepted.
   */
  output?: string | Record<string, unknown>;
  model?: string;
  provider?: string;
  input_tokens?: number;
  output_tokens?: number;
  input_cost_usd?: number;
  output_cost_usd?: number;
  metadata?: Record<string, string | number | boolean>;
}

export interface BreadcrumbSpan {
  set(data: SpanData): void;
}

export interface SpanOptions {
  type?: "llm" | "tool" | "retrieval" | "step";
}

export interface SpanPayload {
  id: string;
  trace_id: string;
  parent_span_id?: string;
  name: string;
  type: string;
  start_time: string;
  end_time: string;
  status: "ok" | "error";
  status_message?: string;
  input?: unknown;
  output?: unknown;
  provider?: string;
  model?: string;
  input_tokens?: number;
  output_tokens?: number;
  input_cost_usd?: number;
  output_cost_usd?: number;
  metadata?: Record<string, string>;
}

/**
 * Called for each span before it is sent to the Breadcrumb API.
 * Return the (possibly modified) payload to send it, or `null` to drop the span.
 */
export type BeforeSendHook = (payload: SpanPayload) => SpanPayload | null | Promise<SpanPayload | null>;

export interface Breadcrumb {
  trace<T>(name: string, fn: (span: BreadcrumbSpan) => Promise<T>): Promise<T>;
  span<T>(
    name: string,
    fn: (span: BreadcrumbSpan) => Promise<T>,
    options?: SpanOptions,
  ): Promise<T>;
  /** @internal — used by @breadcrumb-sdk/ai-sdk to get a tracer */
  __provider: import("@opentelemetry/sdk-trace-node").NodeTracerProvider;
}
