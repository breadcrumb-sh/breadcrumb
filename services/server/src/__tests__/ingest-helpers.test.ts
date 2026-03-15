import { describe, it, expect } from "vitest";
import { toChDate, toMicroDollars, toJson } from "../services/ingest/helpers.js";

describe("toChDate", () => {
  it("converts ISO 8601 to ClickHouse datetime format", () => {
    expect(toChDate("2026-02-20T09:03:08.617Z")).toBe("2026-02-20 09:03:08.617");
  });

  it("replaces T separator with a space", () => {
    expect(toChDate("2024-01-01T00:00:00.000Z")).toContain(" ");
    expect(toChDate("2024-01-01T00:00:00.000Z")).not.toContain("T");
  });

  it("strips the trailing Z", () => {
    expect(toChDate("2024-01-01T00:00:00.000Z")).not.toContain("Z");
  });

  it("preserves millisecond precision", () => {
    expect(toChDate("2026-02-20T09:03:08.617Z")).toBe("2026-02-20 09:03:08.617");
  });
});

describe("toMicroDollars", () => {
  it("converts float USD to integer micro-dollars", () => {
    expect(toMicroDollars(1)).toBe(1_000_000);
    expect(toMicroDollars(0.5)).toBe(500_000);
  });

  it("handles small fractional values without floating-point drift", () => {
    // 0.001 * 1_000_000 = 999.9999... without rounding
    expect(toMicroDollars(0.001)).toBe(1_000);
    expect(toMicroDollars(0.000066)).toBe(66);
    expect(toMicroDollars(0.000150)).toBe(150);
  });

  it("returns 0 for undefined", () => {
    expect(toMicroDollars(undefined)).toBe(0);
  });

  it("returns 0 for 0", () => {
    expect(toMicroDollars(0)).toBe(0);
  });

  it("rounds to the nearest micro-dollar", () => {
    // Exact round-trip: 0.0000001 USD = 0.1 µUSD → rounds to 0
    expect(toMicroDollars(0.0000001)).toBe(0);
    expect(toMicroDollars(0.0000005)).toBe(1);
  });
});

describe("toJson", () => {
  it("returns empty string for undefined", () => {
    expect(toJson(undefined)).toBe("");
  });

  it("returns empty string for null", () => {
    expect(toJson(null)).toBe("");
  });

  it("passes strings through unchanged", () => {
    expect(toJson("hello")).toBe("hello");
    expect(toJson('{"key":"value"}')).toBe('{"key":"value"}');
  });

  it("JSON-serialises objects", () => {
    expect(toJson({ role: "user", content: "hi" })).toBe('{"role":"user","content":"hi"}');
  });

  it("JSON-serialises arrays", () => {
    expect(toJson([1, 2, 3])).toBe("[1,2,3]");
  });

  it("JSON-serialises numbers and booleans", () => {
    expect(toJson(42)).toBe("42");
    expect(toJson(true)).toBe("true");
  });
});
