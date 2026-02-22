import { AsyncLocalStorage } from "node:async_hooks";
import { wrapLanguageModel } from "ai";

// ── Duck-typed Breadcrumb interfaces ──────────────────────────────────────────
// No hard dep on @breadcrumb/sdk at the type level — structural typing handles it.

type BcSpanType = "llm" | "tool" | "retrieval" | "step" | "custom";

interface BcTimer {
  readonly id: string;
  track(name: string, type: BcSpanType, opts?: {
    model?: string;
    provider?: string;
    input?: unknown;
  }): BcTimer;
  end(opts?: {
    output?: unknown;
    inputTokens?: number;
    outputTokens?: number;
    status?: string;
    statusMessage?: string;
    model?: string;
    provider?: string;
  }): unknown;
}

interface BcAgent {
  track(name: string, type: BcSpanType, opts?: {
    model?: string;
    provider?: string;
    input?: unknown;
  }): BcTimer;
  end(opts?: { output?: unknown; status?: string; statusMessage?: string }): void;
}

/** Any object with an `agent()` factory — satisfied by `Breadcrumb`. */
interface BcClient {
  agent(opts: {
    name: string;
    input?: unknown;
    userId?: string;
    sessionId?: string;
    id?: string;
    metadata?: Record<string, string>;
  }): BcAgent;
}

// ── Module-level ALS ──────────────────────────────────────────────────────────
// Stores the currently active BcAgent so subagent.traceModel() can find it
// without being passed explicitly.
const als = new AsyncLocalStorage<BcAgent>();

// ── Helpers ───────────────────────────────────────────────────────────────────

type LM         = Parameters<typeof wrapLanguageModel>[0]["model"];
type GenResult  = Awaited<ReturnType<LM["doGenerate"]>>;
type StrmResult = Awaited<ReturnType<LM["doStream"]>>;
type StrmChunk  = StrmResult["stream"] extends ReadableStream<infer C> ? C : never;

function trimProvider(raw: string): string {
  return raw.split(".")[0]; // "anthropic.messages" → "anthropic"
}

// ── Core wrapping ─────────────────────────────────────────────────────────────

function wrapWithAgent(rawModel: LM, agent: BcAgent): LM {
  return wrapLanguageModel({
    model: rawModel,
    middleware: {
      specificationVersion: "v3" as const,

      // ── Non-streaming ─────────────────────────────────────────────────────

      wrapGenerate: async ({ doGenerate, model: m }: {
        doGenerate: () => PromiseLike<GenResult>;
        model: LM;
        params: unknown;
      }) => {
        const timer = agent.track(m.modelId, "llm", {
          model:    m.modelId,
          provider: trimProvider(m.provider),
        });

        let result: GenResult;
        try {
          result = await doGenerate();
        } catch (err) {
          timer.end({
            status:        "error",
            statusMessage: err instanceof Error ? err.message : String(err),
          });
          throw err;
        }

        // Tool call spans nest under the LLM span (timer.track, not agent.track)
        for (const item of result.content) {
          if (item.type === "tool-call") {
            timer.track(item.toolName, "tool", { input: item.input }).end({});
          }
        }

        const text = result.content
          .filter((c): c is Extract<typeof c, { type: "text" }> => c.type === "text")
          .map(c => c.text)
          .join("");

        timer.end({
          output:       text || undefined,
          inputTokens:  result.usage.inputTokens.total  ?? undefined,
          outputTokens: result.usage.outputTokens.total ?? undefined,
        });

        return result;
      },

      // ── Streaming ─────────────────────────────────────────────────────────

      wrapStream: async ({ doStream, model: m }: {
        doStream: () => PromiseLike<StrmResult>;
        model: LM;
        params: unknown;
      }) => {
        const timer = agent.track(m.modelId, "llm", {
          model:    m.modelId,
          provider: trimProvider(m.provider),
        });

        let streamResult: StrmResult;
        try {
          streamResult = await doStream();
        } catch (err) {
          timer.end({
            status:        "error",
            statusMessage: err instanceof Error ? err.message : String(err),
          });
          throw err;
        }

        let outputText = "";
        let timerDone  = false;
        // Tool timers nest under the LLM timer
        const pendingTools = new Map<string, BcTimer>();

        const instrumented = streamResult.stream.pipeThrough(
          new TransformStream<StrmChunk, StrmChunk>({
            transform(chunk, controller) {
              if (chunk.type === "text-delta") {
                outputText += (chunk as { delta: string }).delta;

              } else if (chunk.type === "tool-input-start") {
                const c = chunk as { id: string; toolName: string };
                // Nest tool timer under LLM timer
                pendingTools.set(c.id, timer.track(c.toolName, "tool"));

              } else if (chunk.type === "tool-call") {
                const c = chunk as { toolCallId: string; input: string };
                const t = pendingTools.get(c.toolCallId);
                if (t) { t.end({ output: c.input }); pendingTools.delete(c.toolCallId); }

              } else if (chunk.type === "finish") {
                const c = chunk as {
                  usage: { inputTokens: { total?: number }; outputTokens: { total?: number } };
                };
                for (const t of pendingTools.values()) t.end({});
                pendingTools.clear();
                timerDone = true;
                timer.end({
                  output:       outputText || undefined,
                  inputTokens:  c.usage.inputTokens.total  ?? undefined,
                  outputTokens: c.usage.outputTokens.total ?? undefined,
                });

              } else if (chunk.type === "error") {
                for (const t of pendingTools.values()) t.end({ status: "error" });
                pendingTools.clear();
                if (!timerDone) { timerDone = true; timer.end({ status: "error" }); }
              }

              controller.enqueue(chunk);
            },

            flush() {
              for (const t of pendingTools.values()) t.end({});
              if (!timerDone) { timerDone = true; timer.end({ output: outputText || undefined }); }
            },
          }),
        );

        return { ...streamResult, stream: instrumented };
      },
    },
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface TraceAgentOpts {
  /** A Breadcrumb instance (or any object with an `agent()` factory). */
  client: BcClient;
  name: string;
  input?: unknown;
  userId?: string;
  sessionId?: string;
  /** Resume an existing trace by providing its ID. */
  id?: string;
  metadata?: Record<string, string>;
}

export interface TraceAgentHandle {
  /**
   * Wraps a raw model so every call is tracked as an LLM span under this
   * agent's trace. Tool call spans nest automatically under the LLM span.
   */
  traceModel(rawModel: LM): LM;

  /**
   * Start a manually timed span under this agent's trace.
   * Use for non-LLM work (retrieval, DB calls, etc.).
   * Call `.end()` on the returned timer when the work completes.
   */
  track(name: string, type: BcSpanType, opts?: {
    input?: unknown;
    model?: string;
    provider?: string;
  }): BcTimer;

  /**
   * Explicitly scope a function to this agent's ALS context.
   * Required when running multiple agents concurrently — `traceAgent()` uses
   * `enterWith` which works for sequential usage; `run()` scopes precisely.
   */
  run<T>(fn: () => Promise<T>): Promise<T>;

  /** Close the trace. Call when all work for this agent is complete. */
  end(opts?: { output?: unknown; status?: string; statusMessage?: string }): void;
}

/**
 * Creates a trace agent that tracks LLM calls, tool invocations, and subagent
 * spans automatically.
 *
 * The agent is set as the active ALS context so `subagent.traceModel()` works
 * inside tool `execute` functions without any extra wiring.
 *
 * @example
 * ```ts
 * const agent = traceAgent({ client: bc, name: "my-agent", input: { query } });
 *
 * const { text } = await generateText({ model: agent.traceModel(rawModel), prompt: query });
 *
 * await generateText({
 *   model: agent.traceModel(rawModel),
 *   tools: {
 *     lookup: tool({
 *       inputSchema: z.object({ q: z.string() }),
 *       execute: async ({ q }) => {
 *         // subagent reads agent from ALS — no explicit wiring needed
 *         const { object } = await generateObject({ model: subagent.traceModel(rawModel), ... });
 *         return object;
 *       },
 *     }),
 *   },
 * });
 *
 * agent.end({ output: text });
 * ```
 */
export function traceAgent(opts: TraceAgentOpts): TraceAgentHandle {
  const { client, name, input, userId, sessionId, id, metadata } = opts;
  const agent = client.agent({ name, input, userId, sessionId, id, metadata });

  // Set this agent as the active ALS context for the current async tree.
  // All async operations started from the caller (generateText, tool executes,
  // etc.) inherit this context, so subagent.traceModel() finds it automatically.
  //
  // For concurrent agents, use agent.run() to create an explicit scope instead.
  als.enterWith(agent);

  return {
    traceModel(rawModel: LM): LM {
      return wrapWithAgent(rawModel, agent);
    },

    track(name: string, type: BcSpanType, opts?) {
      return agent.track(name, type, opts);
    },

    run<T>(fn: () => Promise<T>): Promise<T> {
      return als.run(agent, fn);
    },

    end(endOpts?) {
      agent.end(endOpts ?? {});
    },
  };
}

/**
 * Reads the active agent from ALS and wraps the given model to track calls
 * under the same trace. Use inside tool `execute` functions to continue a
 * parent agent's trace into a nested LLM call.
 *
 * Returns the raw model unchanged if called outside a `traceAgent` context.
 *
 * @example
 * ```ts
 * execute: async ({ city }) => {
 *   const { object } = await generateObject({
 *     model: subagent.traceModel(rawModel),
 *     schema: WeatherSchema,
 *     prompt: `Weather for ${city}`,
 *   });
 *   return object;
 * }
 * ```
 */
export const subagent = {
  traceModel(rawModel: LM): LM {
    const agent = als.getStore();
    if (!agent) return rawModel;
    return wrapWithAgent(rawModel, agent);
  },
};
