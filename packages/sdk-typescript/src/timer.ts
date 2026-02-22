import { generateSpanId } from "@breadcrumb/core";
import type { IngestClient, SpanId, TraceId, SpanType } from "@breadcrumb/core";
import type { TrackOptions, TimerEndOptions, Usage } from "./types.js";

export class Timer {
  readonly id: SpanId;
  readonly #client: IngestClient;
  readonly #traceId: TraceId;
  readonly #parentSpanId: SpanId | undefined;
  readonly #name: string;
  readonly #type: SpanType;
  readonly #startTime: string;
  readonly #opts: TrackOptions;
  #ended = false;

  constructor(
    client: IngestClient,
    traceId: TraceId,
    name: string,
    type: SpanType,
    opts: TrackOptions = {},
    parentSpanId?: SpanId,
  ) {
    this.id = generateSpanId();
    this.#client = client;
    this.#traceId = traceId;
    this.#name = name;
    this.#type = type;
    this.#startTime = new Date().toISOString();
    this.#opts = opts;
    this.#parentSpanId = parentSpanId;
  }

  /** Create a nested child timer. */
  track(name: string, type: SpanType, opts?: TrackOptions): Timer {
    return new Timer(this.#client, this.#traceId, name, type, opts, this.id);
  }

  end(opts: TimerEndOptions = {}): Usage {
    if (this.#ended) return {};
    this.#ended = true;

    const {
      output, status, statusMessage,
      model, provider,
      inputTokens, outputTokens, totalTokens,
      inputCostUsd, outputCostUsd,
    } = opts;

    this.#client.sendSpan({
      id: this.id,
      trace_id: this.#traceId,
      parent_span_id: this.#parentSpanId,
      name: this.#name,
      type: this.#type,
      start_time: this.#startTime,
      end_time: new Date().toISOString(),
      status: status ?? "ok",
      status_message: statusMessage,
      input: this.#opts.input,
      output,
      provider: provider ?? this.#opts.provider,
      model: model ?? this.#opts.model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      input_cost_usd: inputCostUsd,
      output_cost_usd: outputCostUsd,
      metadata: this.#opts.metadata,
    });

    const usage: Usage = {};
    if (inputTokens !== undefined) usage.inputTokens = inputTokens;
    if (outputTokens !== undefined) usage.outputTokens = outputTokens;
    if (totalTokens !== undefined) usage.totalTokens = totalTokens;
    if (inputCostUsd !== undefined) usage.inputCostUsd = inputCostUsd;
    if (outputCostUsd !== undefined) usage.outputCostUsd = outputCostUsd;
    return usage;
  }
}
