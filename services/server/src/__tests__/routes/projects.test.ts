import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock external dependencies ───────────────────────────────────────────────

const mockOrderBy = vi.fn();
const mockLimit = vi.fn();
const mockReturning = vi.fn();
const mockInnerJoin = vi.fn();
const mockLeftJoin = vi.fn();
const mockOnConflictDoUpdate = vi.fn();
const mockOnConflictDoNothing = vi.fn();

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
    onConflictDoNothing: mockOnConflictDoNothing,
    execute: vi.fn().mockResolvedValue([]),
  };
  return { db: chain };
});

const mockCommand = vi.fn().mockResolvedValue(undefined);

vi.mock("../../shared/db/clickhouse.js", () => ({
  clickhouse: { query: vi.fn(), insert: vi.fn(), command: mockCommand },
  readonlyClickhouse: { query: vi.fn() },
}));

const mockEnv = {
  encryptionKey: "a".repeat(64),
  appBaseUrl: "http://localhost:3000",
  allowOpenSignupOrgIds: [] as string[],
  allowOrgCreation: true,
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


vi.mock("../../shared/lib/sandboxed-query.js", () => ({
  runSandboxedQuery: vi.fn().mockResolvedValue([]),
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
  mockOnConflictDoNothing.mockReset();
  mockCommand.mockReset().mockResolvedValue(undefined);
  mockEnv.allowOrgCreation = true;
});

// ── Helper contexts ──────────────────────────────────────────────────────────

const userCtx = {
  user: { id: "user-1", email: "user@test.com", name: "User" },
  session: { id: "sess-1", userId: "user-1" },
};

const unauthCtx = { user: null, session: null };

const ORG_ID = "org-1";

// ── organizations.list ──────────────────────────────────────────────────────

describe("organizations.list", () => {
  it("returns orgs for authenticated member", async () => {
    const orgs = [{ id: "org-1", name: "Org 1" }];
    // member lookup: where() terminal
    mockWhere.mockResolvedValueOnce([{ organizationId: "org-1" }]);
    // org query: where().orderBy()
    mockWhere.mockReturnValueOnce(chain);
    mockOrderBy.mockResolvedValueOnce(orgs);

    const caller = appRouter.createCaller(userCtx);
    const result = await caller.organizations.list();
    expect(result).toEqual(orgs);
  });

  it("throws UNAUTHORIZED when not authenticated", async () => {
    const caller = appRouter.createCaller(unauthCtx);
    await expect(caller.organizations.list()).rejects.toThrow("UNAUTHORIZED");
  });
});

// ── organizations.create ────────────────────────────────────────────────────

describe("organizations.create", () => {
  it("any authenticated user can create an org", async () => {
    const org = { id: "new-org", name: "My Org", slug: "my-org-abc12345" };
    // insert().values().returning()
    mockReturning.mockResolvedValueOnce([org]);
    // member insert — no returning needed

    const caller = appRouter.createCaller(userCtx);
    const result = await caller.organizations.create({ name: "My Org" });
    expect(result).toEqual(org);
  });

  it("rejects when org creation is disabled", async () => {
    mockEnv.allowOrgCreation = false;
    const caller = appRouter.createCaller(userCtx);
    await expect(
      caller.organizations.create({ name: "My Org" })
    ).rejects.toThrow("Organization creation is disabled");
  });
});

// ── projects.list ───────────────────────────────────────────────────────────

describe("projects.list", () => {
  it("returns projects for org member", async () => {
    const projects = [{ id: "proj-1", name: "Project 1", organizationId: ORG_ID }];
    // checkOrgRole: where() terminal
    mockWhere.mockResolvedValueOnce([{ role: "member" }]);
    // project query: where().orderBy()
    mockWhere.mockReturnValueOnce(chain);
    mockOrderBy.mockResolvedValueOnce(projects);

    const caller = appRouter.createCaller(userCtx);
    const result = await caller.projects.list({ organizationId: ORG_ID });
    expect(result).toEqual(projects);
  });

  it("throws UNAUTHORIZED when not authenticated", async () => {
    const caller = appRouter.createCaller(unauthCtx);
    await expect(
      caller.projects.list({ organizationId: ORG_ID })
    ).rejects.toThrow("UNAUTHORIZED");
  });
});

// ── projects.create ─────────────────────────────────────────────────────────

describe("projects.create", () => {
  it("requires org admin role", async () => {
    // checkOrgRole: user is only member
    mockWhere.mockResolvedValueOnce([{ role: "member" }]);

    const caller = appRouter.createCaller(userCtx);
    await expect(
      caller.projects.create({ organizationId: ORG_ID, name: "Test" })
    ).rejects.toThrow("FORBIDDEN");
  });

  it("creates project for org admin", async () => {
    const proj = { id: "new-proj", name: "My Project", organizationId: ORG_ID };
    // checkOrgRole: admin
    mockWhere.mockResolvedValueOnce([{ role: "admin" }]);
    // insert().values().returning()
    mockReturning.mockResolvedValueOnce([proj]);

    const caller = appRouter.createCaller(userCtx);
    const result = await caller.projects.create({
      organizationId: ORG_ID,
      name: "My Project",
    });
    expect(result).toEqual(proj);
  });
});

// ── projects.rename ─────────────────────────────────────────────────────────

describe("projects.rename", () => {
  it("requires admin role via project→org resolution", async () => {
    // resolveProject: where() terminal
    mockWhere.mockResolvedValueOnce([{ organizationId: ORG_ID }]);
    // checkOrgRole: user is member (not admin)
    mockWhere.mockResolvedValueOnce([{ role: "member" }]);

    const caller = appRouter.createCaller(userCtx);
    await expect(
      caller.projects.rename({ projectId: "proj-1", name: "New Name" })
    ).rejects.toThrow("FORBIDDEN");
  });

  it("succeeds for admin", async () => {
    // resolveProject: where() terminal
    mockWhere.mockResolvedValueOnce([{ organizationId: ORG_ID }]);
    // checkOrgRole: admin
    mockWhere.mockResolvedValueOnce([{ role: "admin" }]);
    // update().set().where().returning()
    mockWhere.mockReturnValueOnce(chain);
    mockReturning.mockResolvedValueOnce([{ id: "proj-1", name: "New Name" }]);

    const caller = appRouter.createCaller(userCtx);
    const result = await caller.projects.rename({ projectId: "proj-1", name: "New Name" });
    expect(result).toEqual({ id: "proj-1", name: "New Name" });
  });
});

// ── projects.delete ─────────────────────────────────────────────────────────

describe("projects.delete", () => {
  it("requires owner role", async () => {
    // select project.organizationId
    mockWhere.mockResolvedValueOnce([{ organizationId: ORG_ID }]);
    // checkOrgRole: user is admin (not owner)
    mockWhere.mockResolvedValueOnce([{ role: "admin" }]);

    const caller = appRouter.createCaller(userCtx);
    await expect(
      caller.projects.delete({ projectId: "proj-1" })
    ).rejects.toThrow("FORBIDDEN");
  });

  it("calls ClickHouse DELETE for traces, spans, and rollups", async () => {
    // select project.organizationId
    mockWhere.mockResolvedValueOnce([{ organizationId: ORG_ID }]);
    // checkOrgRole: owner
    mockWhere.mockResolvedValueOnce([{ role: "owner" }]);
    // delete().where() for postgres
    mockWhere.mockResolvedValueOnce(undefined);

    const caller = appRouter.createCaller(userCtx);
    await caller.projects.delete({ projectId: "proj-1" });

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
});
