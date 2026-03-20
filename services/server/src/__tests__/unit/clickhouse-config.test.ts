import { beforeEach, describe, expect, it, vi } from "vitest";

describe("readonlyClickhouse credentials", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("falls back to the main ClickHouse user when readonly env vars are absent", async () => {
    vi.doMock("@clickhouse/client", () => ({
      createClient: vi.fn((config) => config),
    }));
    vi.doMock("../../env.js", () => ({
      env: {
        clickhouseUrl: "http://localhost:8123",
        clickhouseDb: "breadcrumb",
        clickhouseUser: "default",
        clickhousePassword: "secret",
        clickhouseReadonlyUser: undefined,
        clickhouseReadonlyPassword: undefined,
      },
    }));
    vi.doMock("../../shared/lib/logger.js", () => ({
      createLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      }),
    }));

    const { readonlyClickhouse } = await import("../../shared/db/clickhouse.js");
    const readonlyConfig = readonlyClickhouse as unknown as {
      username: string;
      password: string;
    };
    expect(readonlyConfig.username).toBe("default");
    expect(readonlyConfig.password).toBe("secret");
  });

  it("uses the readonly ClickHouse user when readonly env vars are set", async () => {
    vi.doMock("@clickhouse/client", () => ({
      createClient: vi.fn((config) => config),
    }));
    vi.doMock("../../env.js", () => ({
      env: {
        clickhouseUrl: "http://localhost:8123",
        clickhouseDb: "breadcrumb",
        clickhouseUser: "default",
        clickhousePassword: "secret",
        clickhouseReadonlyUser: "readonly",
        clickhouseReadonlyPassword: "readonly-secret",
      },
    }));
    vi.doMock("../../shared/lib/logger.js", () => ({
      createLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      }),
    }));

    const { readonlyClickhouse } = await import("../../shared/db/clickhouse.js");
    const readonlyConfig = readonlyClickhouse as unknown as {
      username: string;
      password: string;
    };
    expect(readonlyConfig.username).toBe("readonly");
    expect(readonlyConfig.password).toBe("readonly-secret");
  });
});
