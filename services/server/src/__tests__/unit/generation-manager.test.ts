import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { StreamEvent } from "../../services/explore/types.js";
import {
  startGeneration,
  getGeneration,
  subscribeGeneration,
} from "../../services/explore/generation-manager.js";

async function collectEvents(gen: AsyncGenerator<StreamEvent>) {
  const events: StreamEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("generation-manager", () => {
  it("startGeneration creates a new generation slot", () => {
    const { gen } = startGeneration("explore-1");
    expect(gen).toBeDefined();
    expect(gen.events).toEqual([]);
    expect(gen.done).toBe(false);
  });

  it("getGeneration returns the active generation", () => {
    startGeneration("explore-2");
    const gen = getGeneration("explore-2");
    expect(gen).toBeDefined();
    expect(gen!.done).toBe(false);
  });

  it("getGeneration returns undefined for unknown exploreId", () => {
    expect(getGeneration("nonexistent-id")).toBeUndefined();
  });

  it("push sends events to listeners", () => {
    const { gen, push } = startGeneration("explore-3");
    const received: StreamEvent[] = [];
    gen.listeners.add((e) => received.push(e));

    push({ type: "text-delta", content: "hello" });
    expect(received).toEqual([{ type: "text-delta", content: "hello" }]);
  });

  it('push with "done" event marks generation as done', () => {
    const { gen, push } = startGeneration("explore-4");
    push({ type: "done" });
    expect(gen.done).toBe(true);
  });

  it("subscribeGeneration replays buffered events", async () => {
    const { push } = startGeneration("explore-5");
    push({ type: "text-delta", content: "a" });
    push({ type: "text-delta", content: "b" });
    push({ type: "done" });

    const ac = new AbortController();
    const events = await collectEvents(subscribeGeneration("explore-5", ac.signal));
    expect(events).toEqual([
      { type: "text-delta", content: "a" },
      { type: "text-delta", content: "b" },
      { type: "done" },
    ]);
  });

  it("subscribeGeneration yields new events after replay", async () => {
    const { push } = startGeneration("explore-6");
    push({ type: "text-delta", content: "buffered" });

    const ac = new AbortController();
    const gen = subscribeGeneration("explore-6", ac.signal);

    // Get the buffered event
    const first = await gen.next();
    expect(first.value).toEqual({ type: "text-delta", content: "buffered" });

    // Push a new event and consume it
    push({ type: "text-delta", content: "live" });
    const second = await gen.next();
    expect(second.value).toEqual({ type: "text-delta", content: "live" });

    // End the stream
    push({ type: "done" });
    const third = await gen.next();
    expect(third.value).toEqual({ type: "done" });

    const end = await gen.next();
    expect(end.done).toBe(true);
  });

  it("subscribeGeneration stops when signal is aborted", async () => {
    const { push } = startGeneration("explore-7");
    const ac = new AbortController();
    const gen = subscribeGeneration("explore-7", ac.signal);

    // Push an event and consume it
    push({ type: "text-delta", content: "first" });
    const first = await gen.next();
    expect(first.value).toEqual({ type: "text-delta", content: "first" });

    // Abort the signal
    ac.abort();

    // The generator should terminate
    const result = await gen.next();
    expect(result.done).toBe(true);
  });

  it("subscribeGeneration returns immediately if generation doesn't exist", async () => {
    const ac = new AbortController();
    const events = await collectEvents(
      subscribeGeneration("nonexistent-explore", ac.signal)
    );
    expect(events).toEqual([]);
  });

  it("starting a new generation aborts the previous one", () => {
    const { signal: signal1 } = startGeneration("explore-8");
    expect(signal1.aborted).toBe(false);

    startGeneration("explore-8");
    expect(signal1.aborted).toBe(true);
  });

  it("done generation is cleaned up after timeout", () => {
    const { push } = startGeneration("explore-9");
    push({ type: "done" });

    expect(getGeneration("explore-9")).toBeDefined();

    vi.advanceTimersByTime(60_000);

    expect(getGeneration("explore-9")).toBeUndefined();
  });
});
