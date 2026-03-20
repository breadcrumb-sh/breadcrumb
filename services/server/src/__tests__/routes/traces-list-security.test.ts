import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mockReadonlyQuery = vi.fn().mockResolvedValue({
  json: () => Promise.resolve([]),
});

const mockCacheGet = vi.fn().mockResolvedValue(null);
const mockCacheSet = vi.fn().mockResolvedValue(undefined);
const mockGetAiModel = vi.fn().mockResolvedValue({ id: "model" });
const mockWriteSearchQuery = vi.fn();

vi.mock("../../shared/db/clickhouse.js", () => ({
  clickhouse: { query: vi.fn(), insert: vi.fn() },
  readonlyClickhouse: { query: mockReadonlyQuery },
}));

vi.mock("../../shared/db/postgres.js", () => ({
  db: {
    select: vi.fn(),
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
    orderBy: vi.fn(),
  },
}));

vi.mock("../../shared/lib/cache.js", () => ({
  cache: {
    get: mockCacheGet,
    set: mockCacheSet,
  },
}));

vi.mock("../../services/explore/ai-provider.js", () => ({
  getAiModel: mockGetAiModel,
}));

vi.mock("../../services/explore/query-writer.js", () => ({
  writeSearchQuery: mockWriteSearchQuery,
}));

vi.mock("../../env.js", () => ({
  env: {
    allowPublicViewing: false,
    encryptionKey: "a".repeat(64),
  },
}));

const { initQueryValidator } = await import("../../shared/lib/query-validator.js");
const { listRouter } = await import("../../api/trpc/traces/list.js");

beforeAll(async () => {
  await initQueryValidator();
});

beforeEach(() => {
  mockReadonlyQuery.mockClear();
  mockCacheGet.mockClear();
  mockCacheSet.mockClear();
  mockGetAiModel.mockClear();
  mockWriteSearchQuery.mockClear();
  mockWriteSearchQuery.mockResolvedValue({
    clause: "EXISTS (SELECT 1 FROM spans s WHERE s.name = 'x')",
  });
});

describe("traces.list security hardening", () => {
  it("executes the rewritten AI clause with project scoping and sandbox settings", async () => {
    const caller = listRouter.createCaller({
      user: {
        id: "admin-user",
        email: "admin@example.com",
        name: "Admin",
        role: "admin",
      },
      session: null,
    });

    await caller.list({
      projectId: "00000000-0000-0000-0000-000000000001",
      limit: 10,
      offset: 0,
      query: "find traces with matching spans",
      sortBy: "startTime",
      sortDir: "desc",
    });

    expect(mockReadonlyQuery).toHaveBeenCalledOnce();
    const queryArg = mockReadonlyQuery.mock.calls[0][0];
    expect(queryArg.query).toContain(
      "s.project_id = {projectId: UUID} AND s.name = 'x'",
    );
    expect(queryArg.clickhouse_settings).toMatchObject({
      max_execution_time: 30,
      max_result_rows: "10000",
      max_rows_to_read: "1000000",
      max_memory_usage: "500000000",
    });
  });

  it("falls back to basic text search when the AI writer returns no clause", async () => {
    mockWriteSearchQuery.mockResolvedValueOnce({ clause: null });

    const caller = listRouter.createCaller({
      user: {
        id: "admin-user",
        email: "admin@example.com",
        name: "Admin",
        role: "admin",
      },
      session: null,
    });

    const result = await caller.list({
      projectId: "00000000-0000-0000-0000-000000000001",
      limit: 10,
      offset: 0,
      query: "claude",
      sortBy: "startTime",
      sortDir: "desc",
    });

    expect(result.searchMode).toBe("text");
    const queryArg = mockReadonlyQuery.mock.calls[0][0];
    expect(queryArg.query).toContain("input ilike {searchText: String}");
    expect(queryArg.query_params.searchText).toBe("%claude%");
  });
});
