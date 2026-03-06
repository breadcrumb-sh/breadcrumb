export interface BreadcrumbSpan {
  set(attributes: Record<string, unknown>): void;
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
