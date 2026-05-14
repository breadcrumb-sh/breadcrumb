import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { randomBytes } from "node:crypto";

const TEST_KEY = randomBytes(32).toString("hex");

vi.mock("../../env.js", () => ({
  env: { encryptionKey: TEST_KEY },
}));

const {
  signStateToken,
  verifyStateToken,
  __resetStateTokenKeyCache,
} = await import("../../shared/lib/state-token.js");

beforeEach(() => {
  __resetStateTokenKeyCache();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("state-token", () => {
  it("round-trips a payload", async () => {
    const token = await signStateToken({
      projectId: "proj_abc",
      userId: "user_xyz",
    });
    const payload = await verifyStateToken(token);
    expect(payload).toEqual({ projectId: "proj_abc", userId: "user_xyz" });
  });

  it("returns null for a tampered token", async () => {
    const token = await signStateToken({
      projectId: "proj_abc",
      userId: "user_xyz",
    });
    // Flip a character in the signature (last segment).
    const parts = token.split(".");
    const sig = parts[2];
    const tampered = sig.endsWith("A")
      ? sig.slice(0, -1) + "B"
      : sig.slice(0, -1) + "A";
    const bad = `${parts[0]}.${parts[1]}.${tampered}`;
    expect(await verifyStateToken(bad)).toBeNull();
  });

  it("returns null for a token signed with a different key", async () => {
    // Sign with the current key, then swap the key cache and try to verify.
    const token = await signStateToken({
      projectId: "proj_abc",
      userId: "user_xyz",
    });
    // Cause the next verify to derive from a different env value.
    vi.resetModules();
    vi.doMock("../../env.js", () => ({
      env: { encryptionKey: randomBytes(32).toString("hex") },
    }));
    const { verifyStateToken: verifyWithOtherKey, __resetStateTokenKeyCache: reset } =
      await import("../../shared/lib/state-token.js");
    reset();
    expect(await verifyWithOtherKey(token)).toBeNull();
    vi.doUnmock("../../env.js");
    vi.resetModules();
  });

  it("returns null for an expired token", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const token = await signStateToken(
      { projectId: "proj_abc", userId: "user_xyz" },
      { ttlSeconds: 60 },
    );
    // Jump past the expiry plus jose's small clock tolerance.
    vi.setSystemTime(new Date("2026-01-01T00:02:00Z"));
    expect(await verifyStateToken(token)).toBeNull();
  });

  it("returns null for a malformed token", async () => {
    expect(await verifyStateToken("not.a.jwt")).toBeNull();
    expect(await verifyStateToken("")).toBeNull();
    expect(await verifyStateToken("garbage")).toBeNull();
  });

  it("each token has a unique jti (no replay-friendly determinism)", async () => {
    const a = await signStateToken({ projectId: "p", userId: "u" });
    const b = await signStateToken({ projectId: "p", userId: "u" });
    expect(a).not.toBe(b);
  });
});
