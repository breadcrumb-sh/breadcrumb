import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { init } from "@polyglot-sql/sdk";

const mockReadonlyQuery = vi.fn();

vi.mock("../../shared/db/clickhouse.js", () => ({
  readonlyClickhouse: { query: mockReadonlyQuery },
}));

vi.mock("../../shared/lib/telemetry.js", () => ({
  trackSlowClickhouseQuery: vi.fn(),
  trackQueryRejected: vi.fn(),
}));

vi.mock("../../shared/lib/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

beforeAll(async () => {
  await init();
});

const { runSandboxedQuery } = await import(
  "../../shared/lib/sandboxed-query.js"
);

beforeEach(() => {
  mockReadonlyQuery.mockReset();
  mockReadonlyQuery.mockResolvedValue({ json: () => Promise.resolve([]) });
});

describe("runSandboxedQuery", () => {
  it("uses readonlyClickhouse for all queries", async () => {
    await runSandboxedQuery("proj-1", "SELECT 1");
    expect(mockReadonlyQuery).toHaveBeenCalledOnce();
  });

  it("includes projectId in query_params", async () => {
    await runSandboxedQuery("my-project-id", "SELECT 1");
    expect(mockReadonlyQuery.mock.calls[0][0].query_params).toMatchObject({
      projectId: "my-project-id",
    });
  });

  it("includes extraParams in query_params", async () => {
    await runSandboxedQuery("proj-1", "SELECT 1", "explore", {
      tz: "UTC",
      days: 30,
    });
    expect(mockReadonlyQuery.mock.calls[0][0].query_params).toMatchObject({
      projectId: "proj-1",
      tz: "UTC",
      days: 30,
    });
  });

  it("requests JSONEachRow format", async () => {
    await runSandboxedQuery("proj-1", "SELECT 1");
    expect(mockReadonlyQuery.mock.calls[0][0].format).toBe("JSONEachRow");
  });

  it("throws QueryValidationError for invalid SQL", async () => {
    await expect(
      runSandboxedQuery("proj-1", "DROP TABLE traces"),
    ).rejects.toThrow("Only SELECT statements are allowed");
  });

  it("throws QueryValidationError for disallowed tables", async () => {
    await expect(
      runSandboxedQuery("proj-1", "SELECT * FROM system.processes"),
    ).rejects.toThrow();
  });

  it("injects project_id filter into the query", async () => {
    await runSandboxedQuery("proj-1", "SELECT * FROM spans");
    const executedSql = mockReadonlyQuery.mock.calls[0][0].query;
    expect(executedSql).toContain("project_id");
    expect(executedSql).toContain("{projectId: UUID}");
  });

  it("passes resource limit settings to ClickHouse", async () => {
    await runSandboxedQuery("proj-1", "SELECT * FROM spans");
    const settings = mockReadonlyQuery.mock.calls[0][0].clickhouse_settings;
    expect(settings).toMatchObject({
      max_execution_time: 30,
      max_result_rows: "10000",
      result_overflow_mode: "throw",
      max_result_bytes: "1048576",
      max_rows_to_read: "1000000",
      max_bytes_to_read: "25000000",
      max_memory_usage: "500000000",
    });
  });

  it("passes abort_signal to ClickHouse when provided", async () => {
    const controller = new AbortController();
    await runSandboxedQuery(
      "proj-1",
      "SELECT * FROM spans",
      "explore",
      undefined,
      { abortSignal: controller.signal },
    );
    expect(mockReadonlyQuery.mock.calls[0][0].abort_signal).toBe(
      controller.signal,
    );
  });
});
