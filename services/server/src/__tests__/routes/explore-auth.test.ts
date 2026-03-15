import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock external dependencies ───────────────────────────────────────────────

const mockWhere = vi.fn();
const mockLimit = vi.fn();
const mockOrderBy = vi.fn();
const mockInnerJoin = vi.fn();
const mockReturning = vi.fn();

vi.mock("../../shared/db/postgres.js", () => {
  const chain: any = {
    select: () => chain,
    from: () => chain,
    where: mockWhere,
    limit: mockLimit,
    orderBy: mockOrderBy,
    innerJoin: mockInnerJoin,
    insert: () => chain,
    values: () => chain,
    returning: mockReturning,
    update: () => chain,
    set: () => chain,
    delete: () => chain,
  };
  return { db: chain };
});

vi.mock("../../shared/db/clickhouse.js", () => ({
  clickhouse: { query: vi.fn(), insert: vi.fn() },
  readonlyClickhouse: { query: vi.fn() },
  sandboxedClickhouse: { query: vi.fn() },
}));

vi.mock("../../env.js", () => ({
  env: {
    allowPublicViewing: false,
    encryptionKey: "a".repeat(64),
  },
}));

vi.mock("../../shared/lib/cache.js", () => ({
  cache: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../services/explore/ai-provider.js", () => ({
  getAiModel: vi.fn(),
}));

vi.mock("../../services/explore/query-writer.js", () => ({
  writeSearchQuery: vi.fn(),
}));

vi.mock("../../services/explore/generation-manager.js", () => ({
  getGeneration: vi.fn().mockReturnValue(null),
  subscribeGeneration: vi.fn(),
}));

vi.mock("../../services/explore/generation.js", () => ({
  runGeneration: vi.fn(),
}));

vi.mock("../../shared/lib/sandboxed-query.js", () => ({
  runSandboxedQuery: vi.fn().mockResolvedValue([]),
}));

const { appRouter } = await import("../../api/trpc/router.js");

beforeEach(() => {
  mockWhere.mockReset();
  mockLimit.mockReset();
  mockOrderBy.mockReset();
  mockInnerJoin.mockReset();
  mockReturning.mockReset();
});

// ── explore.chat ownership check ─────────────────────────────────────────────

describe("explores.chat — project ownership check", () => {
  it("silently returns when explore belongs to a different project", async () => {
    const authedCaller = appRouter.createCaller({
      user: { id: "user-1", email: "u@test.com", name: "User", role: "user" },
      session: { id: "sess-1", userId: "user-1" },
    });

    // 1st where call: orgMemberProcedure middleware checks membership
    mockWhere.mockResolvedValueOnce([{ role: "member" }]);
    // 2nd where call: chat handler fetches the explore (belongs to project-A)
    mockWhere.mockResolvedValueOnce([{ projectId: "project-A" }]);

    // Call chat with project-B but an explore that belongs to project-A.
    // The subscription should silently return (no events yielded).
    const iterable = await authedCaller.explores.chat({
      exploreId: "explore-1",
      projectId: "project-B",
      prompt: "show me errors",
    });

    const events: unknown[] = [];
    for await (const event of iterable) {
      events.push(event);
    }
    expect(events).toHaveLength(0);
  });
});

// ── explore.get auth check ───────────────────────────────────────────────────

describe("explores.get — auth check", () => {
  it("throws UNAUTHORIZED for unauthenticated user when public viewing is off", async () => {
    // Mock: an explore exists
    mockWhere.mockResolvedValueOnce([
      { id: "explore-1", projectId: "proj-1", name: "Test" },
    ]);

    const unauthCaller = appRouter.createCaller({
      user: null,
      session: null,
    });

    await expect(
      unauthCaller.explores.get({ id: "explore-1" })
    ).rejects.toThrow("UNAUTHORIZED");
  });

  it("succeeds for authenticated user with viewer role", async () => {
    const explore = {
      id: "explore-1",
      projectId: "proj-1",
      name: "Test",
      updatedAt: new Date(),
    };

    // First where call: fetch the explore
    mockWhere.mockResolvedValueOnce([explore]);
    // Second where call: checkOrgRole membership lookup
    mockWhere.mockResolvedValueOnce([{ role: "viewer" }]);

    const authedCaller = appRouter.createCaller({
      user: { id: "user-1", email: "u@test.com", name: "User", role: "user" },
      session: { id: "sess-1", userId: "user-1" },
    });

    const result = await authedCaller.explores.get({ id: "explore-1" });
    expect(result).toMatchObject({ id: "explore-1", name: "Test" });
  });

  it("returns null when explore does not exist", async () => {
    mockWhere.mockResolvedValueOnce([]);

    const unauthCaller = appRouter.createCaller({
      user: null,
      session: null,
    });

    const result = await unauthCaller.explores.get({ id: "nonexistent" });
    expect(result).toBeNull();
  });
});
