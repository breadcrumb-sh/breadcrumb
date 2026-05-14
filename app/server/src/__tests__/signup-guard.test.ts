import { describe, it, expect, vi, beforeEach } from "vitest";

// mockDbLimit is called by both queries in checkSignupAllowed:
//   1st call: db.select().from(user).limit(1)       — checks if any user exists
//   2nd call: db.select().from(invitation).where().limit(1) — checks for invitation
const mockDbLimit = vi.fn();

vi.mock("../env.js", () => ({
  env: {
    allowOpenSignupOrgIds: [],
  },
}));

vi.mock("../shared/db/postgres.js", () => {
  const chain: any = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    limit: mockDbLimit,
  };
  return { db: chain };
});

const { checkSignupAllowed } = await import("../shared/auth/signup-guard.js");

beforeEach(() => {
  mockDbLimit.mockReset();
});

describe("checkSignupAllowed", () => {
  it("allows the first user to sign up without an invitation", async () => {
    mockDbLimit.mockResolvedValueOnce([]); // no existing users
    await expect(checkSignupAllowed("admin@example.com")).resolves.toBeUndefined();
    // Should not query invitations at all
    expect(mockDbLimit).toHaveBeenCalledTimes(1);
  });

  it("blocks signup when users exist but no invitation matches the email", async () => {
    mockDbLimit.mockResolvedValueOnce([{ id: "u1" }]); // users exist
    mockDbLimit.mockResolvedValueOnce([]);              // no invitation
    await expect(checkSignupAllowed("stranger@example.com")).rejects.toThrow(
      "Sign-up requires a valid invitation."
    );
  });

  it("allows signup when a valid pending invitation exists for the email", async () => {
    mockDbLimit.mockResolvedValueOnce([{ id: "u1" }]);    // users exist
    mockDbLimit.mockResolvedValueOnce([{ id: "inv-1" }]); // invitation found
    await expect(checkSignupAllowed("invited@example.com")).resolves.toBeUndefined();
  });
});
