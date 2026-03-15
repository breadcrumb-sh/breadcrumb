import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock external dependencies ───────────────────────────────────────────────
//
// The DB chain mock is tricky: some chains end at .where() (like checkOrgRole),
// while others chain .where().orderBy() or .where().returning().
// We solve this by making mockWhere return chain by default, and setting the
// terminal mocks (mockOrderBy, mockReturning, etc.) to return data.
// For chains that end at .where(), we use mockWhere.mockResolvedValueOnce()
// which makes the returned promise resolve directly.
// For chains that continue, we use mockWhere.mockReturnValueOnce(chain).

const mockOrderBy = vi.fn();
const mockLimit = vi.fn();
const mockReturning = vi.fn();
const mockInnerJoin = vi.fn();
const mockLeftJoin = vi.fn();
const mockOnConflictDoUpdate = vi.fn();

// Build chain lazily so mockWhere reference works
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
    leftJoin: mockLeftJoin,
    insert: () => chain,
    values: () => chain,
    returning: mockReturning,
    update: () => chain,
    set: () => chain,
    delete: () => chain,
    onConflictDoUpdate: mockOnConflictDoUpdate,
    execute: vi.fn().mockResolvedValue([]),
  };
  return { db: chain };
});

const mockCommand = vi.fn().mockResolvedValue(undefined);

vi.mock("../../shared/db/clickhouse.js", () => ({
  clickhouse: { query: vi.fn(), insert: vi.fn(), command: mockCommand },
  readonlyClickhouse: { query: vi.fn() },
  sandboxedClickhouse: { query: vi.fn() },
}));

const mockEnv = {
  allowPublicViewing: false,
  encryptionKey: "a".repeat(64),
  appBaseUrl: "http://localhost:3000",
};

vi.mock("../../env.js", () => ({
  env: mockEnv,
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

vi.mock("../../services/observations/cache.js", () => ({
  invalidateObservationsCache: vi.fn(),
}));

vi.mock("../../shared/lib/encryption.js", () => ({
  encrypt: vi.fn().mockReturnValue("encrypted"),
  decrypt: vi.fn().mockReturnValue("decrypted"),
  maskApiKey: vi.fn().mockReturnValue("bc_****"),
}));

const { appRouter } = await import("../../api/trpc/router.js");

beforeEach(() => {
  mockWhere.mockReset();
  mockLimit.mockReset();
  mockOrderBy.mockReset();
  mockInnerJoin.mockReset();
  mockReturning.mockReset();
  mockLeftJoin.mockReset();
  mockOnConflictDoUpdate.mockReset();
  mockCommand.mockReset().mockResolvedValue(undefined);
  mockEnv.allowPublicViewing = false;
});

// ── Helper contexts ──────────────────────────────────────────────────────────

const adminCtx = {
  user: { id: "admin-1", email: "admin@test.com", name: "Admin", role: "admin" },
  session: { id: "sess-admin", userId: "admin-1" },
};

const userCtx = {
  user: { id: "user-1", email: "user@test.com", name: "User", role: "user" },
  session: { id: "sess-1", userId: "user-1" },
};

const unauthCtx = { user: null, session: null };

// ── projects.list ────────────────────────────────────────────────────────────

describe("projects.list", () => {
  it("returns orgs for authenticated member", async () => {
    const orgs = [{ id: "org-1", name: "Org 1" }];
    // 1st where: member lookup → terminal (checkOrgRole is not called for list,
    // but the member query .where() is terminal)
    mockWhere.mockResolvedValueOnce([{ organizationId: "org-1" }]);
    // 2nd where: .where(inArray(...)).orderBy(...) → where returns chain
    mockWhere.mockReturnValueOnce(chain);
    mockOrderBy.mockResolvedValueOnce(orgs);

    const caller = appRouter.createCaller(userCtx);
    const result = await caller.projects.list();
    expect(result).toEqual(orgs);
  });

  it("returns all orgs when public viewing enabled and no user", async () => {
    mockEnv.allowPublicViewing = true;
    const orgs = [{ id: "org-1", name: "Org 1" }, { id: "org-2", name: "Org 2" }];
    // db.select().from(organization).orderBy(...)
    mockOrderBy.mockResolvedValueOnce(orgs);

    const caller = appRouter.createCaller(unauthCtx);
    const result = await caller.projects.list();
    expect(result).toEqual(orgs);
  });

  it("throws UNAUTHORIZED when no user and public viewing disabled", async () => {
    mockEnv.allowPublicViewing = false;
    const caller = appRouter.createCaller(unauthCtx);
    await expect(caller.projects.list()).rejects.toThrow("UNAUTHORIZED");
  });

  it("admin sees all orgs", async () => {
    const orgs = [{ id: "org-1" }, { id: "org-2" }];
    mockOrderBy.mockResolvedValueOnce(orgs);

    const caller = appRouter.createCaller(adminCtx);
    const result = await caller.projects.list();
    expect(result).toEqual(orgs);
  });
});

// ── projects.create ──────────────────────────────────────────────────────────

describe("projects.create", () => {
  it("requires admin role", async () => {
    const caller = appRouter.createCaller(userCtx);
    await expect(caller.projects.create({ name: "Test" })).rejects.toThrow("FORBIDDEN");
  });

  it("generates slug with random suffix and returns the new org", async () => {
    const org = { id: "new-org", name: "My Project", slug: "my-project-abc12345" };
    // First insert().values().returning()
    mockReturning.mockResolvedValueOnce([org]);
    // Second insert (member) — insert().values() is chain, no returning needed

    const caller = appRouter.createCaller(adminCtx);
    const result = await caller.projects.create({ name: "My Project" });
    expect(result).toEqual(org);
    expect(mockReturning).toHaveBeenCalled();
  });
});

// ── projects.rename ──────────────────────────────────────────────────────────

describe("projects.rename", () => {
  it("requires owner role (via checkOrgRole)", async () => {
    // checkOrgRole: where() is terminal → user has member role (not owner)
    mockWhere.mockResolvedValueOnce([{ role: "member" }]);

    const caller = appRouter.createCaller(userCtx);
    await expect(
      caller.projects.rename({ id: "org-1", name: "New Name" })
    ).rejects.toThrow("FORBIDDEN");
  });

  it("succeeds for owner", async () => {
    // checkOrgRole: where() is terminal → user is owner
    mockWhere.mockResolvedValueOnce([{ role: "owner" }]);
    // update().set().where().returning() → where returns chain
    mockWhere.mockReturnValueOnce(chain);
    mockReturning.mockResolvedValueOnce([{ id: "org-1", name: "New Name" }]);

    const caller = appRouter.createCaller(userCtx);
    const result = await caller.projects.rename({ id: "org-1", name: "New Name" });
    expect(result).toEqual({ id: "org-1", name: "New Name" });
  });
});

// ── projects.delete ──────────────────────────────────────────────────────────

describe("projects.delete", () => {
  it("calls ClickHouse DELETE for traces, spans, and rollups", async () => {
    // delete().where() for the postgres org delete — where is terminal
    mockWhere.mockResolvedValueOnce(undefined);

    const caller = appRouter.createCaller(adminCtx);
    await caller.projects.delete({ id: "org-to-delete" });

    // Should have called clickhouse.command 3 times (traces, spans, rollups)
    expect(mockCommand).toHaveBeenCalledTimes(3);

    const queries = mockCommand.mock.calls.map((c: any[]) => c[0].query);
    expect(queries).toEqual(
      expect.arrayContaining([
        expect.stringContaining("breadcrumb.traces"),
        expect.stringContaining("breadcrumb.spans"),
        expect.stringContaining("breadcrumb.trace_rollups"),
      ])
    );
  });

  it("requires admin role", async () => {
    const caller = appRouter.createCaller(userCtx);
    await expect(caller.projects.delete({ id: "org-1" })).rejects.toThrow("FORBIDDEN");
  });
});
