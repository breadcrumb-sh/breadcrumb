import { describe, it, expect, vi, beforeEach } from "vitest";

const mockQuery = vi.fn();
const mockReadonlyQuery = vi.fn();

vi.mock("../../shared/db/clickhouse.js", () => ({
  sandboxedClickhouse: { query: mockQuery },
  readonlyClickhouse: { query: mockReadonlyQuery },
}));

vi.mock("../../env.js", () => ({
  env: { enableSandboxedQueries: true },
}));

const { runSandboxedQuery } = await import(
  "../../shared/lib/sandboxed-query.js"
);

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ json: () => Promise.resolve([]) });
});

describe("runSandboxedQuery — sanitizeSql behavior", () => {
  it("passes normal SQL through unchanged", async () => {
    await runSandboxedQuery("proj-1", "SELECT 1");
    expect(mockQuery).toHaveBeenCalledOnce();
    expect(mockQuery.mock.calls[0][0].query).toBe("SELECT 1");
  });

  it("strips SETTINGS SQL_project_id = 'evil' at the end", async () => {
    const sql = "SELECT 1 SETTINGS SQL_project_id = 'evil'";
    await runSandboxedQuery("proj-1", sql);
    expect(mockQuery.mock.calls[0][0].query).toBe("SELECT 1");
  });

  it("strips SETTINGS on a new line", async () => {
    const sql = "SELECT 1\nSETTINGS max_threads = 1";
    await runSandboxedQuery("proj-1", sql);
    expect(mockQuery.mock.calls[0][0].query).toBe("SELECT 1");
  });

  it("strips SETTINGS with multiple settings", async () => {
    const sql =
      "SELECT 1 SETTINGS SQL_project_id = 'x', max_threads = 2, readonly = 0";
    await runSandboxedQuery("proj-1", sql);
    expect(mockQuery.mock.calls[0][0].query).toBe("SELECT 1");
  });

  it("does NOT strip SETTINGS inside a single-quoted string literal", async () => {
    const sql = "SELECT 'SETTINGS readonly = 0' AS x";
    await runSandboxedQuery("proj-1", sql);
    expect(mockQuery.mock.calls[0][0].query).toBe(sql);
  });

  it("does NOT strip SETTINGS inside a double-quoted string literal", async () => {
    const sql = 'SELECT "SETTINGS readonly = 0" AS x';
    await runSandboxedQuery("proj-1", sql);
    expect(mockQuery.mock.calls[0][0].query).toBe(sql);
  });

  it("passes projectId via clickhouse_settings", async () => {
    await runSandboxedQuery("my-project-id", "SELECT 1");
    expect(mockQuery.mock.calls[0][0].clickhouse_settings).toEqual({
      SQL_project_id: "my-project-id",
    });
  });

  it("includes projectId in query_params for backward compat", async () => {
    await runSandboxedQuery("my-project-id", "SELECT 1");
    expect(mockQuery.mock.calls[0][0].query_params).toEqual({
      projectId: "my-project-id",
    });
  });

  it("handles empty SQL", async () => {
    await runSandboxedQuery("proj-1", "");
    expect(mockQuery.mock.calls[0][0].query).toBe("");
  });

  it("requests JSONEachRow format", async () => {
    await runSandboxedQuery("proj-1", "SELECT 1");
    expect(mockQuery.mock.calls[0][0].format).toBe("JSONEachRow");
  });
});
