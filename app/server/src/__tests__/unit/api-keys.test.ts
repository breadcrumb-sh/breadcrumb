import { describe, it, expect } from "vitest";
import {
  generateApiKey,
  generateMcpKey,
  hashApiKey,
  getKeyPrefix,
} from "../../shared/lib/api-keys.js";

describe("generateApiKey", () => {
  it('returns a string starting with "bc_"', () => {
    expect(generateApiKey()).toMatch(/^bc_/);
  });

  it("returns a string of correct length (bc_ + 48 hex = 51 chars)", () => {
    expect(generateApiKey()).toHaveLength(51);
  });

  it("produces unique values on successive calls", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a).not.toBe(b);
  });
});

describe("generateMcpKey", () => {
  it('returns a string starting with "mcp_"', () => {
    expect(generateMcpKey()).toMatch(/^mcp_/);
  });

  it("returns a string of correct length (mcp_ + 48 hex = 52 chars)", () => {
    expect(generateMcpKey()).toHaveLength(52);
  });
});

describe("hashApiKey", () => {
  it("returns a 64-char hex string (SHA-256)", () => {
    const hash = hashApiKey("bc_test_key");
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic (same input produces same output)", () => {
    const key = "bc_deterministic_test";
    expect(hashApiKey(key)).toBe(hashApiKey(key));
  });

  it("produces different hashes for different inputs", () => {
    expect(hashApiKey("key_a")).not.toBe(hashApiKey("key_b"));
  });
});

describe("getKeyPrefix", () => {
  it('returns first 10 chars + "..."', () => {
    const key = "bc_1234567890abcdef";
    expect(getKeyPrefix(key)).toBe("bc_1234567...");
  });
});
