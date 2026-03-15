import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock external dependencies ───────────────────────────────────────────────

const mockOrderBy = vi.fn();
const mockLimit = vi.fn();
const mockReturning = vi.fn();
const mockInnerJoin = vi.fn();
const mockLeftJoin = vi.fn();
const mockOnConflictDoUpdate = vi.fn();

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

vi.mock("../../shared/db/clickhouse.js", () => ({
  clickhouse: { query: vi.fn(), insert: vi.fn(), command: vi.fn() },
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

const mockInvalidate = vi.fn();
vi.mock("../../services/observations/cache.js", () => ({
  invalidateObservationsCache: mockInvalidate,
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
  mockInvalidate.mockReset();
  mockEnv.allowPublicViewing = false;
});

// ── Helper contexts ──────────────────────────────────────────────────────────

const memberCtx = {
  user: { id: "user-1", email: "user@test.com", name: "User", role: "user" },
  session: { id: "sess-1", userId: "user-1" },
};

const unauthCtx = { user: null, session: null };

const PROJECT_ID = "project-1";
const OBS_ID = "00000000-0000-0000-0000-000000000001";

// ── observations.list ────────────────────────────────────────────────────────

describe("observations.list", () => {
  it("returns observations for project (orgViewerProcedure)", async () => {
    const obs = [{ id: OBS_ID, name: "Obs 1", projectId: PROJECT_ID }];
    // checkOrgRole: where() terminal
    mockWhere.mockResolvedValueOnce([{ role: "member" }]);
    // observations query: .where().orderBy() → where returns chain
    mockWhere.mockReturnValueOnce(chain);
    mockOrderBy.mockResolvedValueOnce(obs);

    const caller = appRouter.createCaller(memberCtx);
    const result = await caller.observations.list({ projectId: PROJECT_ID });
    expect(result).toEqual(obs);
  });

  it("throws UNAUTHORIZED when no user and public viewing disabled", async () => {
    const caller = appRouter.createCaller(unauthCtx);
    await expect(
      caller.observations.list({ projectId: PROJECT_ID })
    ).rejects.toThrow("UNAUTHORIZED");
  });
});

// ── observations.create ──────────────────────────────────────────────────────

describe("observations.create", () => {
  it("inserts observation and invalidates cache", async () => {
    const newObs = { id: OBS_ID, name: "New Obs", projectId: PROJECT_ID };
    // checkOrgRole: where() terminal
    mockWhere.mockResolvedValueOnce([{ role: "member" }]);
    // insert().values().returning()
    mockReturning.mockResolvedValueOnce([newObs]);

    const caller = appRouter.createCaller(memberCtx);
    const result = await caller.observations.create({
      projectId: PROJECT_ID,
      name: "New Obs",
    });
    expect(result).toEqual(newObs);
    expect(mockInvalidate).toHaveBeenCalledWith(PROJECT_ID);
  });
});

// ── observations.setEnabled ──────────────────────────────────────────────────

describe("observations.setEnabled", () => {
  it("updates enabled flag, scoped by projectId AND id", async () => {
    const updated = { id: OBS_ID, enabled: false, projectId: PROJECT_ID };
    // checkOrgRole: where() terminal
    mockWhere.mockResolvedValueOnce([{ role: "member" }]);
    // update().set().where().returning() → where returns chain
    mockWhere.mockReturnValueOnce(chain);
    mockReturning.mockResolvedValueOnce([updated]);

    const caller = appRouter.createCaller(memberCtx);
    const result = await caller.observations.setEnabled({
      projectId: PROJECT_ID,
      id: OBS_ID,
      enabled: false,
    });
    expect(result).toEqual(updated);
    expect(mockInvalidate).toHaveBeenCalledWith(PROJECT_ID);
  });
});

// ── observations.delete ──────────────────────────────────────────────────────

describe("observations.delete", () => {
  it("deletes observation and invalidates cache", async () => {
    // checkOrgRole: where() terminal
    mockWhere.mockResolvedValueOnce([{ role: "member" }]);
    // delete().where() terminal
    mockWhere.mockResolvedValueOnce(undefined);

    const caller = appRouter.createCaller(memberCtx);
    await caller.observations.delete({ projectId: PROJECT_ID, id: OBS_ID });
    expect(mockInvalidate).toHaveBeenCalledWith(PROJECT_ID);
  });
});

// ── observations.findings.listAll ────────────────────────────────────────────

describe("observations['findings.listAll']", () => {
  it("returns non-dismissed findings ordered by impact", async () => {
    const findings = [
      { id: "f-1", impact: "high", title: "Critical issue", dismissed: false },
      { id: "f-2", impact: "medium", title: "Warning", dismissed: false },
    ];
    // checkOrgRole: where() terminal
    mockWhere.mockResolvedValueOnce([{ role: "member" }]);
    // select().from().leftJoin().where().orderBy()
    // leftJoin returns chain, where returns chain
    mockLeftJoin.mockReturnValueOnce(chain);
    mockWhere.mockReturnValueOnce(chain);
    mockOrderBy.mockResolvedValueOnce(findings);

    const caller = appRouter.createCaller(memberCtx);
    const result = await caller.observations["findings.listAll"]({
      projectId: PROJECT_ID,
    });
    expect(result).toEqual(findings);
  });
});

// ── observations.findings.dismiss ────────────────────────────────────────────

describe("observations['findings.dismiss']", () => {
  it("sets dismissed=true, scoped by projectId AND id", async () => {
    const dismissed = { id: OBS_ID, dismissed: true, projectId: PROJECT_ID };
    // checkOrgRole: where() terminal
    mockWhere.mockResolvedValueOnce([{ role: "member" }]);
    // update().set().where().returning() → where returns chain
    mockWhere.mockReturnValueOnce(chain);
    mockReturning.mockResolvedValueOnce([dismissed]);

    const caller = appRouter.createCaller(memberCtx);
    const result = await caller.observations["findings.dismiss"]({
      projectId: PROJECT_ID,
      id: OBS_ID,
    });
    expect(result).toEqual(dismissed);
  });
});

// ── observations.markViewed ──────────────────────────────────────────────────

describe("observations.markViewed", () => {
  it("upserts observation view record", async () => {
    // checkOrgRole: where() terminal
    mockWhere.mockResolvedValueOnce([{ role: "member" }]);
    // insert().values().onConflictDoUpdate()
    mockOnConflictDoUpdate.mockResolvedValueOnce(undefined);

    const caller = appRouter.createCaller(memberCtx);
    await caller.observations.markViewed({ projectId: PROJECT_ID });
    expect(mockOnConflictDoUpdate).toHaveBeenCalled();
  });
});

// ── observations.unreadCount ─────────────────────────────────────────────────

describe("observations.unreadCount", () => {
  it("returns 0 for unauthenticated viewer when public viewing is on", async () => {
    mockEnv.allowPublicViewing = true;

    const caller = appRouter.createCaller(unauthCtx);
    const result = await caller.observations.unreadCount({
      projectId: PROJECT_ID,
    });
    expect(result).toBe(0);
  });
});
