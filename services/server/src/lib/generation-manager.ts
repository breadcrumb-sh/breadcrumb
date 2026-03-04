import type { StreamEvent } from "./explore-types.js";

interface ActiveGeneration {
  events: StreamEvent[];
  done: boolean;
  listeners: Set<(event: StreamEvent) => void>;
  abort: AbortController;
}

const active = new Map<string, ActiveGeneration>();

/** Get or create a generation slot for an exploreId. */
export function getGeneration(exploreId: string): ActiveGeneration | undefined {
  return active.get(exploreId);
}

/** Start a generation. Returns the slot and a push function. */
export function startGeneration(exploreId: string) {
  // If one is already running, abort it
  const existing = active.get(exploreId);
  if (existing && !existing.done) {
    existing.abort.abort();
  }

  const abort = new AbortController();
  const gen: ActiveGeneration = {
    events: [],
    done: false,
    listeners: new Set(),
    abort,
  };
  active.set(exploreId, gen);

  const push = (event: StreamEvent) => {
    gen.events.push(event);
    for (const listener of gen.listeners) {
      listener(event);
    }
    if (event.type === "done" || event.type === "error") {
      gen.done = true;
      // Clean up after a delay so late-comers can still replay
      setTimeout(() => {
        if (active.get(exploreId) === gen) {
          active.delete(exploreId);
        }
      }, 60_000);
    }
  };

  return { gen, push, signal: abort.signal };
}

/**
 * Subscribe to a generation. Replays all past events, then streams new ones.
 * Returns an async generator the tRPC subscription can yield from.
 */
export async function* subscribeGeneration(
  exploreId: string,
  signal: AbortSignal,
): AsyncGenerator<StreamEvent> {
  const gen = active.get(exploreId);
  if (!gen) return;

  // Replay buffered events
  let cursor = 0;
  for (; cursor < gen.events.length; cursor++) {
    if (signal.aborted) return;
    yield gen.events[cursor];
  }

  if (gen.done) return;

  // Stream new events as they arrive
  const queue: StreamEvent[] = [];
  let resolve: (() => void) | null = null;

  const listener = (event: StreamEvent) => {
    queue.push(event);
    resolve?.();
  };
  gen.listeners.add(listener);

  try {
    while (!signal.aborted) {
      if (queue.length > 0) {
        const event = queue.shift()!;
        yield event;
        if (event.type === "done" || event.type === "error") return;
      } else {
        // Wait for next event
        await new Promise<void>((r) => {
          resolve = r;
          // Also resolve if aborted
          signal.addEventListener("abort", () => r(), { once: true });
        });
        resolve = null;
      }
    }
  } finally {
    gen.listeners.delete(listener);
  }
}
