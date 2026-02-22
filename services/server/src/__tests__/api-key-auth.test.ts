import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

const mockLimit = vi.fn();

vi.mock("../db/index.js", () => ({
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

const { requireApiKey } = await import("../auth/index.js");

function buildApp() {
  const app = new Hono();
  app.use("*", requireApiKey);
  app.get("/test", (c) => c.json({ projectId: (c as any).get("projectId") }));
  return app;
}

beforeEach(() => {
  mockLimit.mockReset();
});

describe("requireApiKey", () => {
  it("returns 401 when Authorization header is missing", async () => {
    const res = await buildApp().request("/test");
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "Missing API key" });
  });

  it("returns 401 when Authorization is not a Bearer token", async () => {
    const res = await buildApp().request("/test", {
      headers: { Authorization: "Basic abc123" },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "Missing API key" });
  });

  it("returns 401 when the key is not found in the database", async () => {
    mockLimit.mockResolvedValueOnce([]);
    const res = await buildApp().request("/test", {
      headers: { Authorization: "Bearer bc_unknown_key_1" },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "Invalid API key" });
  });

  it("passes and sets projectId on the context when the key is valid", async () => {
    const projectId = "org-abc-123";
    mockLimit.mockResolvedValueOnce([{ projectId }]);
    const res = await buildApp().request("/test", {
      headers: { Authorization: "Bearer bc_valid_key_2" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ projectId });
  });
});
