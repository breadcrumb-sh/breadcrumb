import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

const mockWhere = vi.fn();

vi.mock("../db/index.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: mockWhere,
      }),
    }),
  },
}));

const { requireOrgRole, requireOrgMember } = await import("../trpc/orgAccess.js");

beforeEach(() => {
  mockWhere.mockReset();
});

describe("requireOrgRole", () => {
  it("resolves without a DB call when the user is a global admin", async () => {
    await expect(
      requireOrgRole("user-1", "admin", "org-1", ["owner"])
    ).resolves.toBeUndefined();
    expect(mockWhere).not.toHaveBeenCalled();
  });

  it("resolves when the user has a matching org role", async () => {
    mockWhere.mockResolvedValueOnce([{ role: "owner" }]);
    await expect(
      requireOrgRole("user-2", "user", "org-1", ["owner", "admin"])
    ).resolves.toBeUndefined();
  });

  it("throws FORBIDDEN when the user's org role is not in the allowed list", async () => {
    mockWhere.mockResolvedValueOnce([{ role: "member" }]);
    await expect(
      requireOrgRole("user-3", "user", "org-1", ["owner", "admin"])
    ).rejects.toThrow(TRPCError);

    mockWhere.mockResolvedValueOnce([{ role: "member" }]);
    const err = await requireOrgRole("user-3", "user", "org-1", ["owner", "admin"]).catch(
      (e) => e
    );
    expect(err.code).toBe("FORBIDDEN");
  });

  it("throws FORBIDDEN when the user is not a member of the org", async () => {
    mockWhere.mockResolvedValueOnce([]);
    const err = await requireOrgRole("user-4", "user", "org-1", ["member"]).catch((e) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect(err.code).toBe("FORBIDDEN");
  });
});

describe("requireOrgMember", () => {
  it("resolves for any standard org role (member, admin, owner)", async () => {
    for (const role of ["member", "admin", "owner"]) {
      mockWhere.mockResolvedValueOnce([{ role }]);
      await expect(requireOrgMember("user-5", "user", "org-1")).resolves.toBeUndefined();
    }
  });

  it("resolves without a DB call for global admin", async () => {
    await expect(requireOrgMember("user-6", "admin", "org-1")).resolves.toBeUndefined();
    expect(mockWhere).not.toHaveBeenCalled();
  });
});
