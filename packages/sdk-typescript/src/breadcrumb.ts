import { IngestClient } from "@breadcrumb/core";
import { Agent } from "./agent.js";
import { agentStore } from "./store.js";
import type { BreadcrumbOptions, AgentOptions } from "./types.js";

/**
 * The main entry point for the Breadcrumb SDK.
 *
 * @example
 * ```ts
 * import { Breadcrumb } from "@breadcrumb/sdk";
 *
 * const bc = new Breadcrumb({ apiKey: "bc_live_...", baseUrl: "https://ingest.breadcrumb.dev" });
 *
 * // ── Option 1: manual form (recommended) ──────────────────────────────────
 * // Creates the trace, sets ALS context via enterWith, returns Agent.
 * // Call agent.end() when done. Use agent.run() if you need concurrent agents.
 *
 * const agent = bc.agent({ name: "chat", input: { query } });
 * const t = agent.track("respond", "llm", { provider: "anthropic", model: "claude-opus-4-6" });
 * const { text } = await generateText({ ... });
 * t.end({ output: text });
 * agent.end({ output: text });
 *
 * // ── Option 2: callback form ───────────────────────────────────────────────
 * // Auto-closes on return or throw. ALS scoped to the callback.
 *
 * const answer = await bc.agent({ name: "chat", input: { query } }, async (agent) => {
 *   const t = agent.track("respond", "llm", { provider: "anthropic", model: "claude-opus-4-6" });
 *   const { text } = await generateText({ ... });
 *   t.end({ output: text });
 *   return text;
 * });
 *
 * await bc.shutdown();
 * ```
 */
export class Breadcrumb {
  readonly #client: IngestClient;
  readonly #environment: string | undefined;

  constructor(opts: BreadcrumbOptions) {
    const { environment, ...clientOpts } = opts;
    this.#client = new IngestClient(clientOpts);
    this.#environment = environment;
  }

  /**
   * Manual form: creates the trace, sets it as the active ALS context via
   * `enterWith`, and returns the Agent. Call `agent.end()` when done.
   * Use `agent.run(fn)` to create an explicit scope for concurrent agents.
   */
  agent(opts: AgentOptions): Agent;
  /**
   * Callback form: auto-closes on return or throw. ALS is scoped to `fn`.
   */
  agent<T>(opts: AgentOptions, fn: (agent: Agent) => Promise<T>): Promise<T>;
  agent<T>(opts: AgentOptions, fn?: (agent: Agent) => Promise<T>): Promise<T> | Agent {
    const agent = new Agent(this.#client, opts, this.#environment);

    if (!fn) {
      // Set ALS for the caller's async tree so bc.currentAgent() works
      // without a callback. Use agent.run() for explicit scoping.
      agentStore.enterWith(agent);
      return agent;
    }

    return agentStore.run(agent, async () => {
      try {
        const result = await fn(agent);
        agent.end({ output: result as unknown });
        return result;
      } catch (err) {
        agent.end({
          status: "error",
          statusMessage: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    });
  }

  /**
   * Get the currently active agent from AsyncLocalStorage context.
   * Works in tools and any async code called within the agent callback.
   * Returns null when called outside an agent context.
   */
  currentAgent(): Agent | null {
    return agentStore.getStore() ?? null;
  }

  /**
   * Set an agent as the active context for the duration of fn.
   * Use with the manual form when AsyncLocalStorage isn't propagated automatically.
   */
  runWithAgent<T>(agent: Agent, fn: () => Promise<T>): Promise<T> {
    return agentStore.run(agent, fn);
  }

  /** Flush all buffered events immediately. */
  flush(): Promise<void> {
    return this.#client.flush();
  }

  /** Stop the auto-flush timer and flush remaining buffered events. Call before process exit. */
  shutdown(): Promise<void> {
    return this.#client.shutdown();
  }
}
