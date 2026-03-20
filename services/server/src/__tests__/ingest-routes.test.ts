import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

// Mock ClickHouse before any route imports resolve it.
const mockInsert = vi.fn().mockResolvedValue(undefined);
vi.mock("../shared/db/clickhouse.js", () => ({
  clickhouse: { insert: mockInsert },
}));

vi.mock("../shared/lib/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("../shared/lib/telemetry.js", () => ({
  trackTraceIngested: vi.fn(),
  trackSlowIngestBatch: vi.fn(),
}));

vi.mock("../shared/lib/boss.js", () => ({
  boss: { send: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock("../services/observations/cache.js", () => ({
  getObservationsForProject: vi.fn().mockResolvedValue([]),
}));

// Import routes after mocking their dependency.
const { ingestRoutes, traceBatcher, spanBatcher } = await import("../api/ingest/routes.js");

const TEST_PROJECT_ID = "00000000-0000-0000-0000-000000000001";

// Wrap with a fake auth middleware that sets projectId.
function buildApp() {
  const app = new Hono();
  app.use("*", async (c, next) => {
    (c as any).set("projectId", TEST_PROJECT_ID);
    await next();
  });
  app.route("/", ingestRoutes);
  return app;
}

const VALID_TRACE_START = {
  id: "a".repeat(32),
  name: "test-trace",
  start_time: "2026-02-20T09:00:00.000Z",
};

const VALID_TRACE_END = {
  ...VALID_TRACE_START,
  end_time: "2026-02-20T09:00:01.500Z",
  status: "ok",
  output: { answer: "Paris" },
};

const VALID_SPAN = {
  id: "b".repeat(16),
  trace_id: "a".repeat(32),
  name: "claude-completion",
  type: "llm",
  start_time: "2026-02-20T09:00:00.100Z",
  end_time: "2026-02-20T09:00:01.400Z",
  provider: "anthropic",
  model: "claude-opus-4-6",
  input_tokens: 22,
  output_tokens: 10,
  input_cost_usd: 0.000066,
  output_cost_usd: 0.00015,
};

beforeEach(async () => {
  await traceBatcher.flush();
  await spanBatcher.flush();
  mockInsert.mockClear();
});

// ── POST /traces ───────────────────────────────────────────────────────────────

describe("POST /traces", () => {
  it("accepts a valid start payload and returns 202", async () => {
    const app = buildApp();
    const res = await app.request("/traces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(VALID_TRACE_START),
    });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("stores null end_time (not epoch) when absent from payload", async () => {
    const app = buildApp();
    await app.request("/traces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(VALID_TRACE_START),
    });
    await traceBatcher.flush();
    const inserted = mockInsert.mock.calls[0][0].values[0];
    expect(inserted.end_time).toBeNull();
  });

  it("stores converted end_time when present in payload", async () => {
    const app = buildApp();
    await app.request("/traces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(VALID_TRACE_END),
    });
    await traceBatcher.flush();
    const inserted = mockInsert.mock.calls[0][0].values[0];
    // toChDate strips T and Z
    expect(inserted.end_time).toBe("2026-02-20 09:00:01.500");
  });

  it("end row version > start row version (race condition fix)", async () => {
    const app = buildApp();

    await app.request("/traces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(VALID_TRACE_START),
    });
    await traceBatcher.flush();
    const startVersion: number = mockInsert.mock.calls[0][0].values[0].version;

    mockInsert.mockClear();

    await app.request("/traces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(VALID_TRACE_END),
    });
    await traceBatcher.flush();
    const endVersion: number = mockInsert.mock.calls[0][0].values[0].version;

    expect(endVersion).toBeGreaterThan(startVersion);
  });

  it("stores the projectId from middleware", async () => {
    const app = buildApp();
    await app.request("/traces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(VALID_TRACE_START),
    });
    await traceBatcher.flush();
    expect(mockInsert.mock.calls[0][0].values[0].project_id).toBe(TEST_PROJECT_ID);
  });

  it("returns 400 for an invalid payload", async () => {
    const app = buildApp();
    const res = await app.request("/traces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "short", name: "" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for malformed JSON", async () => {
    const app = buildApp();
    const res = await app.request("/traces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when trace input is too large", async () => {
    const app = buildApp();
    const res = await app.request("/traces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...VALID_TRACE_START,
        input: "x".repeat(70_000),
      }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 413 when the trace request body is too large", async () => {
    const app = buildApp();
    const res = await app.request("/traces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...VALID_TRACE_START,
        input: "x".repeat(1_200_000),
      }),
    });
    expect(res.status).toBe(413);
  });
});

// ── POST /spans ────────────────────────────────────────────────────────────────

describe("POST /spans", () => {
  it("accepts a single span object and returns 202", async () => {
    const app = buildApp();
    const res = await app.request("/spans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(VALID_SPAN),
    });
    expect(res.status).toBe(202);
  });

  it("accepts an array of spans", async () => {
    const app = buildApp();
    const res = await app.request("/spans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([VALID_SPAN, { ...VALID_SPAN, id: "c".repeat(16) }]),
    });
    await spanBatcher.flush();
    expect(res.status).toBe(202);
    expect(mockInsert.mock.calls[0][0].values).toHaveLength(2);
  });

  it("converts float cost to micro-dollars", async () => {
    const app = buildApp();
    await app.request("/spans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(VALID_SPAN),
    });
    await spanBatcher.flush();
    const inserted = mockInsert.mock.calls[0][0].values[0];
    expect(inserted.input_cost_usd).toBe(66);   // 0.000066 * 1_000_000
    expect(inserted.output_cost_usd).toBe(150); // 0.00015  * 1_000_000
  });

  it("stores projectId and trace_id", async () => {
    const app = buildApp();
    await app.request("/spans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(VALID_SPAN),
    });
    await spanBatcher.flush();
    const inserted = mockInsert.mock.calls[0][0].values[0];
    expect(inserted.project_id).toBe(TEST_PROJECT_ID);
    expect(inserted.trace_id).toBe("a".repeat(32));
  });

  it("returns 400 for an invalid span", async () => {
    const app = buildApp();
    const res = await app.request("/spans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "bad", type: "unknown-type" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when too many spans are sent in one request", async () => {
    const app = buildApp();
    const spans = Array.from({ length: 101 }, (_, i) => ({
      ...VALID_SPAN,
      id: i.toString(16).padStart(16, "0"),
    }));
    const res = await app.request("/spans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(spans),
    });
    expect(res.status).toBe(400);
  });
});
