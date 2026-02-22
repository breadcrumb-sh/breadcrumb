import { generateTraceId, generateSpanId } from "@breadcrumb/core";
import type { IngestClient, TraceId, SpanId, SpanType } from "@breadcrumb/core";
import type { AgentOptions, AgentEndOptions, TrackOptions } from "./types.js";
import { Timer } from "./timer.js";
import { agentStore } from "./store.js";

export class Agent {
  readonly #client: IngestClient;
  readonly #traceId: TraceId;
  readonly #spanId: SpanId | undefined;       // step span ID (subagent only)
  readonly #parentSpanId: SpanId | undefined; // parent span ID for the step span's parent_span_id
  readonly #opts: AgentOptions;
  readonly #environment: string | undefined;
  readonly #startTime: string;
  readonly #isSubagent: boolean;
  #ended = false;

  constructor(
    client: IngestClient,
    opts: AgentOptions,
    environment: string | undefined,
    parentTraceId?: TraceId,
    parentSpanId?: SpanId,
  ) {
    this.#client = client;
    this.#opts = opts;
    this.#environment = environment;
    this.#startTime = new Date().toISOString();
    this.#isSubagent = parentTraceId !== undefined;

    if (this.#isSubagent) {
      this.#traceId = parentTraceId!;
      this.#spanId = generateSpanId();
      this.#parentSpanId = parentSpanId;
    } else {
      this.#traceId = opts.id ?? generateTraceId();
      this.#spanId = undefined;
      this.#parentSpanId = undefined;

      // Send trace start event immediately so it appears in the dashboard
      this.#client.sendTrace({
        id: this.#traceId,
        name: opts.name,
        start_time: this.#startTime,
        input: opts.input,
        user_id: opts.userId,
        session_id: opts.sessionId,
        environment: this.#environment,
        tags: opts.metadata,
      });
    }
  }

  /** The trace ID this agent operates within. Shared across all subagents. */
  get traceId(): TraceId {
    return this.#traceId;
  }

  /** Start a timed span within this agent's trace. Call .end() on the returned Timer when done. */
  track(name: string, type: SpanType, opts?: TrackOptions): Timer {
    return new Timer(this.#client, this.#traceId, name, type, opts, this.#spanId);
  }

  /**
   * Create a step span within this agent's trace.
   * The subagent has the same API as the parent and can be nested arbitrarily deeply.
   * Call .end() on the subagent when its work is complete.
   */
  subagent(opts: AgentOptions): Agent {
    return new Agent(this.#client, opts, this.#environment, this.#traceId, this.#spanId);
  }

  /**
   * Run `fn` with this agent set as the active ALS context.
   * Use when you need an explicit scope (e.g. concurrent agents) instead of
   * relying on the `enterWith` set by `bc.agent(opts)`.
   */
  run<T>(fn: () => Promise<T>): Promise<T> {
    return agentStore.run(this, fn);
  }

  /**
   * End this agent.
   * - Top-level agents: sends the trace end event.
   * - Subagents: sends a "step" span covering the subagent's lifetime.
   */
  end(opts: AgentEndOptions = {}): void {
    if (this.#ended) return;
    this.#ended = true;

    const { output, status, statusMessage } = opts;

    if (this.#isSubagent) {
      this.#client.sendSpan({
        id: this.#spanId!,
        trace_id: this.#traceId,
        parent_span_id: this.#parentSpanId,
        name: this.#opts.name,
        type: "step",
        start_time: this.#startTime,
        end_time: new Date().toISOString(),
        status: status ?? "ok",
        status_message: statusMessage,
        input: this.#opts.input,
        output,
        metadata: this.#opts.metadata,
      });
    } else {
      this.#client.sendTrace({
        id: this.#traceId,
        name: this.#opts.name,
        start_time: this.#startTime,
        end_time: new Date().toISOString(),
        status: status ?? "ok",
        status_message: statusMessage,
        output,
        user_id: this.#opts.userId,
        session_id: this.#opts.sessionId,
        environment: this.#environment,
        tags: this.#opts.metadata,
      });
    }
  }
}
