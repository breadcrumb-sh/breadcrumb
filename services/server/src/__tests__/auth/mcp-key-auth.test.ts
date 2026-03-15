import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

const mockLimit = vi.fn();

vi.mock("../../shared/db/postgres.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: mockLimit,
        }),
      }),
    }),
  },
}));

const { requireMcpKey } = await import("../../shared/auth/mcp-key.js");

function buildApp() {
  const app = new Hono();
  app.use("*", requireMcpKey);
  app.get("/test", (c) => c.json({ userId: (c as any).get("userId") }));
  return app;
}

beforeEach(() => {
  mockLimit.mockReset();
});

describe("requireMcpKey", () => {
  it("returns 401 when Authorization header is missing", async () => {
    const res = await buildApp().request("/test");
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "Missing MCP key" });
  });

  it("returns 401 when Authorization is not a Bearer token", async () => {
    const res = await buildApp().request("/test", {
      headers: { Authorization: "Basic abc123" },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "Missing MCP key" });
  });

  it("returns 401 when the key is not found in the database", async () => {
    mockLimit.mockResolvedValueOnce([]);
    const res = await buildApp().request("/test", {
      headers: { Authorization: "Bearer mcp_unknown_key_1" },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "Invalid MCP key" });
  });

  it("passes and sets userId on the context when the key is valid", async () => {
    const userId = "user-abc-123";
    mockLimit.mockResolvedValueOnce([{ userId }]);
    const res = await buildApp().request("/test", {
      headers: { Authorization: "Bearer mcp_valid_key_1" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId });
  });

  it("uses cached value on second request (verify db mock called only once)", async () => {
    const userId = "user-cached-1";
    mockLimit.mockResolvedValueOnce([{ userId }]);

    const app = buildApp();
    const key = "Bearer mcp_cached_key_1";

    const res1 = await app.request("/test", { headers: { Authorization: key } });
    expect(res1.status).toBe(200);
    expect(await res1.json()).toEqual({ userId });

    // Second request with same key should use cache
    const res2 = await app.request("/test", { headers: { Authorization: key } });
    expect(res2.status).toBe(200);
    expect(await res2.json()).toEqual({ userId });

    // DB should only have been called once
    expect(mockLimit).toHaveBeenCalledTimes(1);
  });
});
