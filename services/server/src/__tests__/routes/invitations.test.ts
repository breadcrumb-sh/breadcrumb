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
}));

vi.mock("../../env.js", () => ({
  env: {
    encryptionKey: "a".repeat(64),
    appBaseUrl: "http://localhost:3000",
    allowOpenSignupOrgIds: [],
    allowOrgCreation: true,
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
});

// ── Helper contexts ──────────────────────────────────────────────────────────

const adminCtx = {
  user: { id: "admin-1", email: "admin@test.com", name: "Admin" },
  session: { id: "sess-admin", userId: "admin-1" },
};

const userCtx = {
  user: { id: "user-1", email: "user@test.com", name: "User" },
  session: { id: "sess-1", userId: "user-1" },
};

const ORG_ID = "org-1";

// ── invitations.create ───────────────────────────────────────────────────────

describe("invitations.create", () => {
  it("rejects if user is already a member", async () => {
    const caller = appRouter.createCaller(adminCtx);

    // checkOrgRole: admin role in org
    mockWhere.mockResolvedValueOnce([{ role: "admin" }]);
    // find user by email → terminal
    mockWhere.mockResolvedValueOnce([{ id: "existing-user" }]);
    // find member by userId + orgId → terminal
    mockWhere.mockResolvedValueOnce([{ id: "member-1" }]);

    await expect(
      caller.invitations.create({
        organizationId: ORG_ID,
        email: "existing@test.com",
      })
    ).rejects.toThrow("already a member");
  });

  it("rejects if pending non-expired invitation exists", async () => {
    const caller = appRouter.createCaller(adminCtx);

    // checkOrgRole: admin
    mockWhere.mockResolvedValueOnce([{ role: "admin" }]);
    // user lookup — no user → terminal
    mockWhere.mockResolvedValueOnce([]);
    // existing pending invitation → terminal
    mockWhere.mockResolvedValueOnce([{ id: "inv-existing" }]);

    await expect(
      caller.invitations.create({
        organizationId: ORG_ID,
        email: "pending@test.com",
      })
    ).rejects.toThrow("pending invitation already exists");
  });

  it("allows creation when no conflicts", async () => {
    const inv = {
      id: "inv-new",
      organizationId: ORG_ID,
      email: "new@test.com",
      role: "member",
      status: "pending",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      inviterId: "admin-1",
    };

    const caller = appRouter.createCaller(adminCtx);

    // checkOrgRole: admin
    mockWhere.mockResolvedValueOnce([{ role: "admin" }]);
    // user lookup — none → terminal
    mockWhere.mockResolvedValueOnce([]);
    // pending invitation — none → terminal
    mockWhere.mockResolvedValueOnce([]);
    // insert().values().returning()
    mockReturning.mockResolvedValueOnce([inv]);

    const result = await caller.invitations.create({
      organizationId: ORG_ID,
      email: "new@test.com",
    });
    expect(result).toMatchObject({
      id: "inv-new",
      inviteUrl: expect.stringContaining("/accept-invite?token=inv-new"),
    });
  });

  it("generates invite URL with token", async () => {
    const inv = {
      id: "inv-abc",
      organizationId: ORG_ID,
      email: "invite@test.com",
      role: "member",
      status: "pending",
    };

    const caller = appRouter.createCaller(adminCtx);

    // checkOrgRole: admin
    mockWhere.mockResolvedValueOnce([{ role: "admin" }]);
    // No existing user → terminal
    mockWhere.mockResolvedValueOnce([]);
    // No existing invitation → terminal
    mockWhere.mockResolvedValueOnce([]);
    // insert returns the invitation
    mockReturning.mockResolvedValueOnce([inv]);

    const result = await caller.invitations.create({
      organizationId: ORG_ID,
      email: "invite@test.com",
    });
    expect(result.inviteUrl).toBe("http://localhost:3000/accept-invite?token=inv-abc");
  });
});

// ── invitations.list ─────────────────────────────────────────────────────────

describe("invitations.list", () => {
  it("returns only pending invitations for the org", async () => {
    const invitations = [
      { id: "inv-1", status: "pending", email: "a@test.com" },
      { id: "inv-2", status: "pending", email: "b@test.com" },
    ];
    // checkOrgRole: where() terminal — user is member
    mockWhere.mockResolvedValueOnce([{ role: "member" }]);
    // invitation query: where() terminal
    mockWhere.mockResolvedValueOnce(invitations);

    const caller = appRouter.createCaller(userCtx);
    const result = await caller.invitations.list({ organizationId: ORG_ID });
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      id: "inv-1",
      inviteUrl: expect.stringContaining("/accept-invite?token=inv-1"),
    });
  });
});

// ── invitations.delete ───────────────────────────────────────────────────────

describe("invitations.delete", () => {
  it("requires admin/owner role", async () => {
    // fetch invitation → terminal
    mockWhere.mockResolvedValueOnce([{ id: "inv-1", organizationId: ORG_ID }]);
    // checkOrgRole — user is only a member → terminal
    mockWhere.mockResolvedValueOnce([{ role: "member" }]);

    const caller = appRouter.createCaller(userCtx);
    await expect(
      caller.invitations.delete({ invitationId: "inv-1" })
    ).rejects.toThrow("FORBIDDEN");
  });

  it("succeeds for org admin", async () => {
    const caller = appRouter.createCaller(adminCtx);

    // fetch invitation → terminal
    mockWhere.mockResolvedValueOnce([{ id: "inv-1", organizationId: ORG_ID }]);
    // checkOrgRole: admin
    mockWhere.mockResolvedValueOnce([{ role: "admin" }]);
    // delete().where() → terminal
    mockWhere.mockResolvedValueOnce(undefined);

    await expect(
      caller.invitations.delete({ invitationId: "inv-1" })
    ).resolves.toBeUndefined();
  });
});
