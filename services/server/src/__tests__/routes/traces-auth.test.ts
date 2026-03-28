import { describe, it, expect, vi } from "vitest";

// ── Mock all external dependencies before importing the router ───────────────

const mockChQuery = vi.fn().mockResolvedValue({
  json: () => Promise.resolve([]),
});

vi.mock("../../shared/db/clickhouse.js", () => ({
  clickhouse: { query: mockChQuery, insert: vi.fn() },
  readonlyClickhouse: { query: mockChQuery },
}));

vi.mock("../../shared/db/postgres.js", () => {
  const chain: any = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    limit: vi.fn().mockResolvedValue([]),
    orderBy: vi.fn().mockResolvedValue([]),
    innerJoin: () => chain,
  };
  return { db: chain };
});

vi.mock("../../env.js", () => ({
  env: {
    encryptionKey: "a".repeat(64),
    allowOpenSignupOrgIds: [],
    allowOrgCreation: true,
  },
}));

vi.mock("../../shared/lib/cache.js", () => ({
  cache: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../services/explore/ai-provider.js", () => ({
  getAiModel: vi.fn(),
}));

vi.mock("../../services/explore/query-writer.js", () => ({
  writeSearchQuery: vi.fn(),
}));

vi.mock("../../services/explore/generation-manager.js", () => ({
  getGeneration: vi.fn(),
  subscribeGeneration: vi.fn(),
}));

vi.mock("../../services/explore/generation.js", () => ({
  runGeneration: vi.fn(),
}));

const { appRouter } = await import("../../api/trpc/router.js");

// ── Test: all 16 traces procedures require auth ──────────────────────────────

const TEST_PROJECT_ID = "00000000-0000-0000-0000-000000000001";
const TEST_TRACE_ID = "a".repeat(32);

// Create a caller with NO user context (unauthenticated).
const unauthCaller = appRouter.createCaller({ user: null, session: null });

describe("traces router — all procedures reject unauthenticated access", () => {
  const procedureCalls: Array<{ name: string; call: () => Promise<unknown> }> = [
    {
      name: "traces.stats",
      call: () => unauthCaller.traces.stats({ projectId: TEST_PROJECT_ID }),
    },
    {
      name: "traces.list",
      call: () =>
        unauthCaller.traces.list({
          projectId: TEST_PROJECT_ID,
          limit: 10,
          offset: 0,
          sortBy: "startTime",
          sortDir: "desc",
        }),
    },
    {
      name: "traces.dailyMetrics",
      call: () =>
        unauthCaller.traces.dailyMetrics({ projectId: TEST_PROJECT_ID }),
    },
    {
      name: "traces.dailyCostByName",
      call: () =>
        unauthCaller.traces.dailyCostByName({ projectId: TEST_PROJECT_ID }),
    },
    {
      name: "traces.qualityTimeline",
      call: () =>
        unauthCaller.traces.qualityTimeline({ projectId: TEST_PROJECT_ID }),
    },
    {
      name: "traces.modelBreakdown",
      call: () =>
        unauthCaller.traces.modelBreakdown({ projectId: TEST_PROJECT_ID }),
    },
    {
      name: "traces.topFailingSpans",
      call: () =>
        unauthCaller.traces.topFailingSpans({ projectId: TEST_PROJECT_ID }),
    },
    {
      name: "traces.topSlowestSpans",
      call: () =>
        unauthCaller.traces.topSlowestSpans({ projectId: TEST_PROJECT_ID }),
    },
    {
      name: "traces.environments",
      call: () =>
        unauthCaller.traces.environments({ projectId: TEST_PROJECT_ID }),
    },
    {
      name: "traces.models",
      call: () =>
        unauthCaller.traces.models({ projectId: TEST_PROJECT_ID }),
    },
    {
      name: "traces.names",
      call: () =>
        unauthCaller.traces.names({ projectId: TEST_PROJECT_ID }),
    },
    {
      name: "traces.dailyCount",
      call: () =>
        unauthCaller.traces.dailyCount({
          projectId: TEST_PROJECT_ID,
          days: 7,
        }),
    },
    {
      name: "traces.spanSample",
      call: () =>
        unauthCaller.traces.spanSample({
          projectId: TEST_PROJECT_ID,
          traceName: "test-trace",
        }),
    },
    {
      name: "traces.loopbackRate",
      call: () =>
        unauthCaller.traces.loopbackRate({
          projectId: TEST_PROJECT_ID,
          traceName: "test-trace",
          sortBy: "rate",
        }),
    },
    {
      name: "traces.get",
      call: () =>
        unauthCaller.traces.get({
          projectId: TEST_PROJECT_ID,
          traceId: TEST_TRACE_ID,
        }),
    },
    {
      name: "traces.spans",
      call: () =>
        unauthCaller.traces.spans({
          projectId: TEST_PROJECT_ID,
          traceId: TEST_TRACE_ID,
        }),
    },
  ];

  for (const { name, call } of procedureCalls) {
    it(`${name} throws UNAUTHORIZED without auth`, async () => {
      await expect(call()).rejects.toThrow("UNAUTHORIZED");
    });
  }
});
