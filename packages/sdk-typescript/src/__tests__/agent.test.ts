import { describe, it, expect, vi } from "vitest";
import { Agent } from "../agent.js";
import type { TracePayload, SpanPayload } from "@breadcrumb/core";

const ENV = "test";

function makeClient() {
  return {
    sendTrace: vi.fn<[TracePayload], void>(),
    sendSpan: vi.fn<[SpanPayload], void>(),
  };
}

describe("Agent (top-level) — construction", () => {
  it("sends a trace start event on construction", () => {
    const client = makeClient();
    new Agent(client as any, { name: "my-agent" }, ENV);
    expect(client.sendTrace).toHaveBeenCalledOnce();
    expect(client.sendTrace.mock.calls[0][0].end_time).toBeUndefined();
  });

  it("start payload includes name and start_time", () => {
    const client = makeClient();
    const before = Date.now();
    new Agent(client as any, { name: "my-agent" }, ENV);
    const payload = client.sendTrace.mock.calls[0][0];
    expect(payload.name).toBe("my-agent");
    expect(new Date(payload.start_time).getTime()).toBeGreaterThanOrEqual(before);
  });

  it("uses provided id as trace id", () => {
    const client = makeClient();
    const id = "a".repeat(32);
    const agent = new Agent(client as any, { name: "my-agent", id }, ENV);
    expect(agent.traceId).toBe(id);
  });

  it("passes userId and metadata through to trace payload", () => {
    const client = makeClient();
    new Agent(client as any, { name: "my-agent", userId: "u1", metadata: { version: "2" } }, ENV);
    const payload = client.sendTrace.mock.calls[0][0];
    expect(payload.user_id).toBe("u1");
    expect(payload.tags).toEqual({ version: "2" });
  });

  it("passes environment from constructor through to trace payload", () => {
    const client = makeClient();
    new Agent(client as any, { name: "my-agent" }, "production");
    expect(client.sendTrace.mock.calls[0][0].environment).toBe("production");
  });
});

describe("Agent (top-level) — end()", () => {
  it("sends an end event with end_time", () => {
    const client = makeClient();
    const agent = new Agent(client as any, { name: "my-agent" }, ENV);
    client.sendTrace.mockClear();
    agent.end();
    expect(client.sendTrace).toHaveBeenCalledOnce();
    expect(client.sendTrace.mock.calls[0][0].end_time).toBeDefined();
  });

  it("end_time is always >= start_time", () => {
    const client = makeClient();
    const agent = new Agent(client as any, { name: "my-agent" }, ENV);
    const startPayload = client.sendTrace.mock.calls[0][0];
    agent.end();
    const endPayload = client.sendTrace.mock.calls[1][0];
    expect(new Date(endPayload.end_time!).getTime())
      .toBeGreaterThanOrEqual(new Date(startPayload.start_time).getTime());
  });

  it("is idempotent — second call is a no-op", () => {
    const client = makeClient();
    const agent = new Agent(client as any, { name: "my-agent" }, ENV);
    client.sendTrace.mockClear();
    agent.end();
    agent.end();
    expect(client.sendTrace).toHaveBeenCalledOnce();
  });

  it("passes output, status, and statusMessage to end payload", () => {
    const client = makeClient();
    const agent = new Agent(client as any, { name: "my-agent" }, ENV);
    client.sendTrace.mockClear();
    agent.end({ status: "error", statusMessage: "boom", output: { result: 42 } });
    const payload = client.sendTrace.mock.calls[0][0];
    expect(payload.status).toBe("error");
    expect(payload.status_message).toBe("boom");
    expect(payload.output).toEqual({ result: 42 });
  });

  it("defaults status to 'ok'", () => {
    const client = makeClient();
    const agent = new Agent(client as any, { name: "my-agent" }, ENV);
    client.sendTrace.mockClear();
    agent.end();
    expect(client.sendTrace.mock.calls[0][0].status).toBe("ok");
  });
});

describe("Agent — track()", () => {
  it("returns a Timer whose span has the correct trace_id", () => {
    const client = makeClient();
    const agent = new Agent(client as any, { name: "my-agent" }, ENV);
    const t = agent.track("llm-call", "llm");
    t.end();
    expect(client.sendSpan.mock.calls[0][0].trace_id).toBe(agent.traceId);
  });

  it("root timers have no parent_span_id", () => {
    const client = makeClient();
    const agent = new Agent(client as any, { name: "my-agent" }, ENV);
    agent.track("llm-call", "llm").end();
    expect(client.sendSpan.mock.calls[0][0].parent_span_id).toBeUndefined();
  });
});

describe("Agent — subagent()", () => {
  it("subagent shares the parent trace_id", () => {
    const client = makeClient();
    const orchestrator = new Agent(client as any, { name: "orchestrator" }, ENV);
    const planner = orchestrator.subagent({ name: "planner" });
    planner.end();
    expect(client.sendSpan.mock.calls[0][0].trace_id).toBe(orchestrator.traceId);
  });

  it("subagent end() sends a step span, not a trace event", () => {
    const client = makeClient();
    const orchestrator = new Agent(client as any, { name: "orchestrator" }, ENV);
    client.sendTrace.mockClear();
    const planner = orchestrator.subagent({ name: "planner" });
    planner.end();
    expect(client.sendTrace).not.toHaveBeenCalled();
    expect(client.sendSpan).toHaveBeenCalledOnce();
    expect(client.sendSpan.mock.calls[0][0].type).toBe("step");
  });

  it("subagent step span has no parent_span_id when parent is top-level", () => {
    const client = makeClient();
    const orchestrator = new Agent(client as any, { name: "orchestrator" }, ENV);
    const planner = orchestrator.subagent({ name: "planner" });
    planner.end();
    expect(client.sendSpan.mock.calls[0][0].parent_span_id).toBeUndefined();
  });

  it("timers created via subagent have the subagent step span as parent", () => {
    const client = makeClient();
    const orchestrator = new Agent(client as any, { name: "orchestrator" }, ENV);
    const planner = orchestrator.subagent({ name: "planner" });
    const t = planner.track("search", "retrieval");
    t.end();      // span sent first
    planner.end(); // step span sent second

    const timerPayload = client.sendSpan.mock.calls[0][0];
    const stepPayload = client.sendSpan.mock.calls[1][0];
    expect(timerPayload.parent_span_id).toBe(stepPayload.id);
  });

  it("nested subagent step span has parent_span_id of intermediate subagent", () => {
    const client = makeClient();
    const root = new Agent(client as any, { name: "root" }, ENV);
    const child = root.subagent({ name: "child" });
    const grandchild = child.subagent({ name: "grandchild" });
    grandchild.end(); // step span sent first
    child.end();      // step span sent second

    const grandchildPayload = client.sendSpan.mock.calls[0][0];
    const childPayload = client.sendSpan.mock.calls[1][0];
    expect(grandchildPayload.parent_span_id).toBe(childPayload.id);
  });
});
