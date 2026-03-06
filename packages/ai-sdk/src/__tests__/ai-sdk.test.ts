import { describe, it, expect, vi } from "vitest";
import { initAiSdk } from "../index.js";
import type { Breadcrumb } from "@breadcrumb/sdk";

// A structural mock — we only care that initAiSdk accepts a Breadcrumb
const mockBc = {
  trace: vi.fn(),
  span: vi.fn(),
} satisfies Breadcrumb;

describe("initAiSdk()", () => {
  it("returns an object with a telemetry function", () => {
    const result = initAiSdk(mockBc);
    expect(typeof result.telemetry).toBe("function");
  });

  describe("telemetry()", () => {
    it("returns isEnabled: true and the functionId", () => {
      const { telemetry } = initAiSdk(mockBc);
      const config = telemetry("my-function");
      expect(config.isEnabled).toBe(true);
      expect(config.functionId).toBe("my-function");
    });

    it("includes metadata when provided", () => {
      const { telemetry } = initAiSdk(mockBc);
      const config = telemetry("plan", { userId: "u1", score: 0.9 });
      expect(config.metadata).toEqual({ userId: "u1", score: 0.9 });
    });

    it("omits the metadata key entirely when not provided (not just undefined)", () => {
      const { telemetry } = initAiSdk(mockBc);
      const config = telemetry("plan");
      expect("metadata" in config).toBe(false);
    });

    it("accepts different functionIds on the same instance", () => {
      const { telemetry } = initAiSdk(mockBc);
      expect(telemetry("step-1").functionId).toBe("step-1");
      expect(telemetry("step-2").functionId).toBe("step-2");
    });

    it("each call returns a fresh object", () => {
      const { telemetry } = initAiSdk(mockBc);
      const a = telemetry("fn", { x: 1 });
      const b = telemetry("fn", { x: 2 });
      expect(a).not.toBe(b);
      expect((a.metadata as { x: number }).x).toBe(1);
      expect((b.metadata as { x: number }).x).toBe(2);
    });
  });
});
