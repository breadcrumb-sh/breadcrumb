import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSandboxedQuery = vi.fn();

vi.mock("../../shared/db/clickhouse.js", () => ({
  sandboxedClickhouse: { query: mockSandboxedQuery },
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

const { runSandboxedQuery } = await import(
  "../../shared/lib/sandboxed-query.js"
);

beforeEach(() => {
  mockSandboxedQuery.mockReset();
  mockSandboxedQuery.mockResolvedValue({ json: () => Promise.resolve([]) });
});

describe("runSandboxedQuery", () => {
  it("uses sandboxedClickhouse for all queries", async () => {
    await runSandboxedQuery("proj-1", "SELECT 1");
    expect(mockSandboxedQuery).toHaveBeenCalledOnce();
  });

  it("passes SQL_project_id as a clickhouse setting", async () => {
    await runSandboxedQuery("my-project-id", "SELECT 1");
    expect(mockSandboxedQuery.mock.calls[0][0].clickhouse_settings).toMatchObject({
      SQL_project_id: "my-project-id",
    });
  });

  it("does not include projectId in query_params", async () => {
    await runSandboxedQuery("my-project-id", "SELECT 1");
    expect(mockSandboxedQuery.mock.calls[0][0].query_params).toBeUndefined();
  });

  it("passes extraParams as query_params", async () => {
    await runSandboxedQuery("proj-1", "SELECT 1", "explore", {
      tz: "UTC",
      days: 30,
    });
    expect(mockSandboxedQuery.mock.calls[0][0].query_params).toMatchObject({
      tz: "UTC",
      days: 30,
    });
  });

  it("does not pass resource limit settings (baked into role)", async () => {
    await runSandboxedQuery("proj-1", "SELECT 1");
    const settings = mockSandboxedQuery.mock.calls[0][0].clickhouse_settings;
    expect(settings).not.toHaveProperty("max_execution_time");
    expect(settings).not.toHaveProperty("max_result_rows");
    expect(settings).not.toHaveProperty("max_memory_usage");
  });

  it("sends the query as-is (no rewriting)", async () => {
    const sql = "SELECT * FROM spans WHERE name = 'test'";
    await runSandboxedQuery("proj-1", sql);
    expect(mockSandboxedQuery.mock.calls[0][0].query).toBe(sql);
  });

  it("requests JSONEachRow format", async () => {
    await runSandboxedQuery("proj-1", "SELECT 1");
    expect(mockSandboxedQuery.mock.calls[0][0].format).toBe("JSONEachRow");
  });

  it("throws QueryValidationError for non-SELECT SQL", async () => {
    await expect(
      runSandboxedQuery("proj-1", "DROP TABLE traces"),
    ).rejects.toThrow("Only SELECT statements are allowed");
  });

  it("throws QueryValidationError for SETTINGS clause", async () => {
    await expect(
      runSandboxedQuery(
        "proj-1",
        "SELECT 1 FROM spans SETTINGS SQL_project_id = 'evil'",
      ),
    ).rejects.toThrow("SETTINGS");
  });

  it("passes abort_signal to ClickHouse when provided", async () => {
    const controller = new AbortController();
    await runSandboxedQuery(
      "proj-1",
      "SELECT 1",
      "explore",
      undefined,
      { abortSignal: controller.signal },
    );
    expect(mockSandboxedQuery.mock.calls[0][0].abort_signal).toBe(
      controller.signal,
    );
  });
});
