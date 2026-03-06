export interface SpanData {
  input?: unknown;
  output?: unknown;
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

export interface Breadcrumb {
  trace<T>(name: string, fn: (span: BreadcrumbSpan) => Promise<T>): Promise<T>;
  span<T>(
    name: string,
    fn: (span: BreadcrumbSpan) => Promise<T>,
    options?: SpanOptions,
  ): Promise<T>;
}
