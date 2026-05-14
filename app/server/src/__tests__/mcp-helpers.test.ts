import { describe, it, expect } from "vitest";
import { calcDuration, normMetadata } from "../services/mcp/helpers.js";

describe("calcDuration", () => {
  it("returns null when endTime is null", () => {
    expect(calcDuration("2026-02-20 09:00:00.000", null)).toBeNull();
  });

  it("returns correct duration in milliseconds", () => {
    expect(calcDuration("2026-02-20 09:00:00.000", "2026-02-20 09:00:01.500")).toBe(1500);
  });

  it("returns null for epoch end_time (the race-condition sentinel)", () => {
    // epoch as end_time means trace.end() version lost the race — must be treated as missing
    expect(calcDuration("2026-02-20 09:00:00.000", "1970-01-01 00:00:00.000")).toBeNull();
  });

  it("returns null when end is before start (negative duration)", () => {
    expect(calcDuration("2026-02-20 09:00:01.000", "2026-02-20 09:00:00.000")).toBeNull();
  });

  it("returns null when start equals end (zero duration)", () => {
    expect(calcDuration("2026-02-20 09:00:00.000", "2026-02-20 09:00:00.000")).toBeNull();
  });

  it("handles sub-second durations correctly", () => {
    expect(calcDuration("2026-02-20 09:00:00.000", "2026-02-20 09:00:00.450")).toBe(450);
  });
});

describe("normMetadata", () => {
  it("returns null for null", () => {
    expect(normMetadata(null)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(normMetadata(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(normMetadata("")).toBeNull();
  });

  it("parses a JSON string into an object", () => {
    expect(normMetadata('{"key":"value"}')).toEqual({ key: "value" });
  });

  it("returns a plain JS object as-is (ClickHouse already parsed it)", () => {
    const obj = { model: "gpt-4" };
    expect(normMetadata(obj)).toBe(obj);
  });

  it("returns a non-JSON string as-is", () => {
    expect(normMetadata("some-string")).toBe("some-string");
  });

  it("does not stringify objects (avoids [object Object])", () => {
    const result = normMetadata({ a: 1 });
    expect(result).not.toBe("[object Object]");
    expect(result).toEqual({ a: 1 });
  });
});
