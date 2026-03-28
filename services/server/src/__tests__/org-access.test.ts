import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

const mockWhere = vi.fn();

vi.mock("../shared/db/postgres.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: mockWhere,
      }),
    }),
  },
}));

vi.mock("../env.js", () => ({
  env: {
    nodeEnv: "test",
    disableTelemetry: true,
  },
}));

const { checkOrgRole } = await import("../trpc.js");

beforeEach(() => {
  mockWhere.mockReset();
});

describe("checkOrgRole", () => {
  it("resolves when the user has a matching org role", async () => {
    mockWhere.mockResolvedValueOnce([{ role: "owner" }]);
    await expect(
      checkOrgRole("user-2", "org-1", ["owner", "admin"])
    ).resolves.toBeUndefined();
  });

  it("throws FORBIDDEN when the user's org role is not in the allowed list", async () => {
    mockWhere.mockResolvedValueOnce([{ role: "member" }]);
    await expect(
      checkOrgRole("user-3", "org-1", ["owner", "admin"])
    ).rejects.toThrow(TRPCError);

    mockWhere.mockResolvedValueOnce([{ role: "member" }]);
    const err = await checkOrgRole("user-3", "org-1", ["owner", "admin"]).catch(
      (e) => e
    );
    expect(err.code).toBe("FORBIDDEN");
  });

  it("throws FORBIDDEN when the user is not a member of the org", async () => {
    mockWhere.mockResolvedValueOnce([]);
    const err = await checkOrgRole("user-4", "org-1", ["member"]).catch((e) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect(err.code).toBe("FORBIDDEN");
  });

  it("resolves for any standard org role (member, admin, owner)", async () => {
    for (const role of ["member", "admin", "owner"]) {
      mockWhere.mockResolvedValueOnce([{ role }]);
      await expect(
        checkOrgRole("user-5", "org-1", ["member", "admin", "owner"])
      ).resolves.toBeUndefined();
    }
  });
});
