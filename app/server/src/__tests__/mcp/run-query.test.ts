import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock dependencies ────────────────────────────────────────────────────────

const mockRunSandboxedQuery = vi.fn();
vi.mock("../../shared/lib/sandboxed-query.js", () => ({
  runSandboxedQuery: mockRunSandboxedQuery,
}));

const mockLimit = vi.fn();
const mockOrderBy = vi.fn();
const mockInnerJoin = vi.fn();

let chain: any;
const mockWhere = vi.fn();

vi.mock("../../shared/db/postgres.js", () => {
  chain = {
    select: () => chain,
    from: () => chain,
    where: mockWhere,
    limit: mockLimit,
    orderBy: mockOrderBy,
    innerJoin: mockInnerJoin,
  };
  return { db: chain };
});

vi.mock("../../shared/db/clickhouse.js", () => ({
  clickhouse: { query: vi.fn() },
  readonlyClickhouse: { query: vi.fn() },
}));

vi.mock("../../env.js", () => ({
  env: {
    encryptionKey: "a".repeat(64),
    allowOpenSignupOrgIds: [],
    allowOrgCreation: true,
  },
}));

vi.mock("../../services/traces/helpers.js", () => ({
  getProjectTimezone: vi.fn().mockResolvedValue("UTC"),
  ROLLUPS_SUBQUERY: vi.fn().mockReturnValue("SELECT 1"),
}));

const { getUserProjectIds, truncateResult } = await import("../../api/mcp/helpers.js");
const { registerQueryTools } = await import("../../api/mcp/tools/query.js");

beforeEach(() => {
  mockRunSandboxedQuery.mockReset();
  mockWhere.mockReset();
  mockLimit.mockReset();
  mockOrderBy.mockReset();
  mockInnerJoin.mockReset();
});

// ── truncateResult unit tests ────────────────────────────────────────────────

describe("truncateResult", () => {
  it("returns row count in data and no note for small results", () => {
    const rows = [{ id: 1 }, { id: 2 }];
    const { data, note } = truncateResult(rows);
    expect(note).toBeNull();
    expect(data).toContain('"id": 1');
  });

  it("truncates large row sets and adds a note", () => {
    const rows = Array.from({ length: 150 }, (_, i) => ({ id: i, name: `row-${i}` }));
    const { note } = truncateResult(rows);
    expect(note).toContain("showing first 100 of 150 rows");
  });

  it("truncates very long JSON output", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      id: i,
      content: "x".repeat(1000),
    }));
    const { note } = truncateResult(rows);
    expect(note).toContain("truncated");
  });
});

// ── getUserProjectIds ────────────────────────────────────────────────────────

describe("getUserProjectIds", () => {
  it("returns project IDs from user's org memberships", async () => {
    // getUserProjectIds now joins member → project via innerJoin
    // db.select({projectId}).from(member).innerJoin(project, ...).where(eq(member.userId, ...))
    mockInnerJoin.mockReturnValueOnce(chain);
    mockWhere.mockResolvedValueOnce([
      { projectId: "proj-1" },
      { projectId: "proj-2" },
    ]);

    const ids = await getUserProjectIds("user-1");
    expect(ids).toEqual(["proj-1", "proj-2"]);
  });

  it("returns empty array when user has no memberships", async () => {
    mockInnerJoin.mockReturnValueOnce(chain);
    mockWhere.mockResolvedValueOnce([]);

    const ids = await getUserProjectIds("user-no-orgs");
    expect(ids).toEqual([]);
  });
});

// ── run_query tool logic (tested via the registered tool) ────────────────────

describe("run_query tool", () => {
  let toolHandlers: Map<string, (...args: any[]) => Promise<any>>;

  beforeEach(() => {
    toolHandlers = new Map();
    const fakeMcpServer = {
      tool: (name: string, _desc: string, _schema: any, handler: any) => {
        toolHandlers.set(name, handler);
      },
    };
    registerQueryTools(fakeMcpServer as any, "test-user");
  });

  function mockUserProjectIds(projectIds: string[]) {
    // getUserProjectIds: member → innerJoin(project) → where
    mockInnerJoin.mockReturnValueOnce(chain);
    mockWhere.mockResolvedValueOnce(projectIds.map((id) => ({ projectId: id })));
  }

  it("rejects when user has no access to the project", async () => {
    mockUserProjectIds([]);

    const handler = toolHandlers.get("run_query")!;
    const result = await handler({
      sql: "SELECT 1",
      project_id: "project-no-access",
    });
    expect(result.content[0].text).toContain("access denied");
  });

  it("calls runSandboxedQuery with correct projectId and sql", async () => {
    mockUserProjectIds(["project-1"]);

    const rows = [{ count: 42 }];
    mockRunSandboxedQuery.mockResolvedValueOnce(rows);

    const handler = toolHandlers.get("run_query")!;
    await handler({ sql: "SELECT count(*) as count", project_id: "project-1" });

    expect(mockRunSandboxedQuery).toHaveBeenCalledWith(
      "project-1",
      "SELECT count(*) as count",
      "mcp",
      { tz: "UTC" },
    );
  });

  it("returns row count in response", async () => {
    mockUserProjectIds(["project-1"]);

    const rows = [{ id: 1 }, { id: 2 }, { id: 3 }];
    mockRunSandboxedQuery.mockResolvedValueOnce(rows);

    const handler = toolHandlers.get("run_query")!;
    const result = await handler({
      sql: "SELECT * FROM traces",
      project_id: "project-1",
    });
    expect(result.content[0].text).toContain("rowCount: 3");
  });

  it("returns truncated result for large row sets", async () => {
    mockUserProjectIds(["project-1"]);

    const rows = Array.from({ length: 200 }, (_, i) => ({ id: i }));
    mockRunSandboxedQuery.mockResolvedValueOnce(rows);

    const handler = toolHandlers.get("run_query")!;
    const result = await handler({
      sql: "SELECT * FROM traces",
      project_id: "project-1",
    });
    expect(result.content[0].text).toContain("rowCount: 200");
    expect(result.content[0].text).toContain("showing first 100");
  });

  it("returns error message on query failure", async () => {
    mockUserProjectIds(["project-1"]);

    mockRunSandboxedQuery.mockRejectedValueOnce(new Error("Syntax error in SQL"));

    const handler = toolHandlers.get("run_query")!;
    const result = await handler({
      sql: "INVALID SQL",
      project_id: "project-1",
    });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe("Syntax error in SQL");
  });
});
