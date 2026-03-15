import { describe, it, expect, vi } from "vitest";
import { randomBytes } from "node:crypto";

// Generate a stable 32-byte hex key for tests.
const TEST_KEY = randomBytes(32).toString("hex");

vi.mock("../../env.js", () => ({
  env: { encryptionKey: TEST_KEY },
}));

const { encrypt, decrypt, maskApiKey } = await import(
  "../../shared/lib/encryption.js"
);

describe("encrypt / decrypt", () => {
  it("round-trips plaintext correctly", () => {
    const plaintext = "super-secret-api-key";
    const encrypted = encrypt(plaintext);
    expect(decrypt(encrypted)).toBe(plaintext);
  });

  it("round-trips empty string", () => {
    const encrypted = encrypt("");
    expect(decrypt(encrypted)).toBe("");
  });

  it("round-trips unicode text", () => {
    const plaintext = "hello world";
    const encrypted = encrypt(plaintext);
    expect(decrypt(encrypted)).toBe(plaintext);
  });

  it("produces different ciphertexts for different plaintexts", () => {
    const a = encrypt("alpha");
    const b = encrypt("bravo");
    expect(a).not.toBe(b);
  });

  it("produces different ciphertexts for the same plaintext (random IV)", () => {
    const a = encrypt("same-text");
    const b = encrypt("same-text");
    expect(a).not.toBe(b);
    // Both still decrypt to the original
    expect(decrypt(a)).toBe("same-text");
    expect(decrypt(b)).toBe("same-text");
  });

  it("encrypted format is 'hex:hex:hex' (iv:ciphertext:authTag)", () => {
    const encrypted = encrypt("test");
    const parts = encrypted.split(":");
    expect(parts).toHaveLength(3);
    // Each part should be a valid hex string
    for (const part of parts) {
      expect(part).toMatch(/^[0-9a-f]+$/);
    }
    // IV should be 12 bytes = 24 hex chars
    expect(parts[0]).toHaveLength(24);
    // Auth tag should be 16 bytes = 32 hex chars
    expect(parts[2]).toHaveLength(32);
  });

  it("fails to decrypt when ciphertext is tampered", () => {
    const encrypted = encrypt("sensitive");
    const parts = encrypted.split(":");
    // Flip a byte in the ciphertext portion
    const tampered = parts[1].length > 2
      ? parts[1].slice(0, -2) + (parts[1].slice(-2) === "00" ? "ff" : "00")
      : "ff";
    const bad = `${parts[0]}:${tampered}:${parts[2]}`;
    expect(() => decrypt(bad)).toThrow();
  });

  it("fails to decrypt when auth tag is tampered", () => {
    const encrypted = encrypt("sensitive");
    const parts = encrypted.split(":");
    // Flip a byte in the auth tag
    const tampered = parts[2].slice(0, -2) + (parts[2].slice(-2) === "00" ? "ff" : "00");
    const bad = `${parts[0]}:${parts[1]}:${tampered}`;
    expect(() => decrypt(bad)).toThrow();
  });
});

describe("maskApiKey", () => {
  it('produces "prefix...suffix" format for long keys', () => {
    const masked = maskApiKey("sk-proj-abcdefghijklmnop");
    expect(masked).toBe("sk-pro...mnop");
  });

  it("shows first 6 and last 4 characters", () => {
    const key = "bc_1234567890abcdef";
    const masked = maskApiKey(key);
    expect(masked).toBe("bc_123...cdef");
  });

  it("returns dots for short keys (10 chars or fewer)", () => {
    expect(maskApiKey("short")).toBe("••••••••");
    expect(maskApiKey("exactly10!")).toBe("••••••••");
  });

  it("handles 11-char key (minimum for prefix...suffix)", () => {
    const masked = maskApiKey("12345678901");
    expect(masked).toBe("123456...8901");
  });
});
