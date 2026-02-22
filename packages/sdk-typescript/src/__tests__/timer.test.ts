import { describe, it, expect, vi } from "vitest";
import { Timer } from "../timer.js";
import type { SpanPayload } from "@breadcrumb/core";

const TRACE_ID = "a".repeat(32);

function makeClient() {
  return { sendTrace: vi.fn(), sendSpan: vi.fn<[SpanPayload], void>() };
}

function makeTimer(client: ReturnType<typeof makeClient>, parentId?: string) {
  return new Timer(client as any, TRACE_ID, "test-span", "llm", {}, parentId as any);
}

describe("Timer — end()", () => {
  it("sends span with start_time and end_time", () => {
    const client = makeClient();
    const before = Date.now();
    const t = makeTimer(client);
    t.end();
    const payload = client.sendSpan.mock.calls[0][0];
    expect(new Date(payload.start_time).getTime()).toBeGreaterThanOrEqual(before);
    expect(new Date(payload.end_time).getTime()).toBeGreaterThanOrEqual(new Date(payload.start_time).getTime());
  });

  it("is idempotent — second call is a no-op", () => {
    const client = makeClient();
    const t = makeTimer(client);
    t.end();
    t.end();
    expect(client.sendSpan).toHaveBeenCalledOnce();
  });

  it("sends trace_id and span id", () => {
    const client = makeClient();
    const t = makeTimer(client);
    t.end();
    const payload = client.sendSpan.mock.calls[0][0];
    expect(payload.trace_id).toBe(TRACE_ID);
    expect(payload.id).toMatch(/^[0-9a-f]{16}$/);
  });

  it("passes LLM fields through on end()", () => {
    const client = makeClient();
    const t = makeTimer(client);
    t.end({
      model: "claude-opus-4-6",
      provider: "anthropic",
      inputTokens: 100,
      outputTokens: 50,
      inputCostUsd: 0.0003,
      outputCostUsd: 0.00075,
      output: { content: "hello" },
    });
    const payload = client.sendSpan.mock.calls[0][0];
    expect(payload.model).toBe("claude-opus-4-6");
    expect(payload.provider).toBe("anthropic");
    expect(payload.input_tokens).toBe(100);
    expect(payload.output_tokens).toBe(50);
    expect(payload.input_cost_usd).toBe(0.0003);
    expect(payload.output_cost_usd).toBe(0.00075);
  });

  it("passes status and statusMessage through on end()", () => {
    const client = makeClient();
    const t = makeTimer(client);
    t.end({ status: "error", statusMessage: "timeout" });
    const payload = client.sendSpan.mock.calls[0][0];
    expect(payload.status).toBe("error");
    expect(payload.status_message).toBe("timeout");
  });

  it("defaults status to 'ok'", () => {
    const client = makeClient();
    const t = makeTimer(client);
    t.end();
    expect(client.sendSpan.mock.calls[0][0].status).toBe("ok");
  });

  it("returns usage with token fields from end()", () => {
    const client = makeClient();
    const t = makeTimer(client);
    const usage = t.end({ inputTokens: 100, outputTokens: 50, inputCostUsd: 0.001 });
    expect(usage.inputTokens).toBe(100);
    expect(usage.outputTokens).toBe(50);
    expect(usage.inputCostUsd).toBe(0.001);
  });

  it("returns empty usage when no token fields provided", () => {
    const client = makeClient();
    const t = makeTimer(client);
    const usage = t.end();
    expect(usage).toEqual({});
  });
});

describe("Timer — nesting via track()", () => {
  it("child timer has parent_span_id set to parent's id", () => {
    const client = makeClient();
    const parent = makeTimer(client);
    const child = parent.track("child", "tool");
    child.end();
    const payload = client.sendSpan.mock.calls[0][0];
    expect(payload.parent_span_id).toBe(parent.id);
  });

  it("root timer has no parent_span_id", () => {
    const client = makeClient();
    const t = makeTimer(client);
    t.end();
    expect(client.sendSpan.mock.calls[0][0].parent_span_id).toBeUndefined();
  });

  it("grandchild shares the same trace_id as root", () => {
    const client = makeClient();
    const root = makeTimer(client);
    const child = root.track("child", "step");
    const grandchild = child.track("grandchild", "llm");
    grandchild.end();
    expect(client.sendSpan.mock.calls[0][0].trace_id).toBe(TRACE_ID);
  });
});
