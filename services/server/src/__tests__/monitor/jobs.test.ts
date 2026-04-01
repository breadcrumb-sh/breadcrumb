import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock setup (hoisted) ────────────────────────────────────────────────────

const mockRunInvestigation = vi.fn();
vi.mock("../../services/monitor/agent.js", () => ({
  runInvestigation: mockRunInvestigation,
}));

const mockRunScan = vi.fn();
vi.mock("../../services/monitor/scan.js", () => ({
  runScan: mockRunScan,
}));

const mockCheckBudget = vi.fn();
const mockGetScanInterval = vi.fn();
vi.mock("../../services/monitor/usage.js", () => ({
  checkBudget: mockCheckBudget,
  getScanInterval: mockGetScanInterval,
  recordUsage: vi.fn(),
}));

const mockEmitMonitorEvent = vi.fn();
vi.mock("../../services/monitor/events.js", () => ({
  emitMonitorEvent: mockEmitMonitorEvent,
}));

const mockRecordActivity = vi.fn();
vi.mock("../../services/monitor/activity.js", () => ({
  recordActivity: mockRecordActivity,
}));

const mockBossSend = vi.fn();
const mockBossInsert = vi.fn();
vi.mock("../../shared/lib/boss.js", () => ({
  boss: {
    send: mockBossSend,
    insert: mockBossInsert,
  },
}));

vi.mock("../../shared/lib/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ── DB mock ─────────────────────────────────────────────────────────────────
//
// Tracks every chained DB operation as structured records so tests can assert
// on the full sequence: which operation (select/update), what table, what
// .set() args, and what .where() args.

interface DbOp {
  kind: "select" | "update";
  table: unknown;
  setArgs?: Record<string, unknown>;
  whereArgs?: unknown[];
}

const dbOps: DbOp[] = [];
const mockDbSelectResult = vi.fn<() => Promise<unknown[]>>().mockResolvedValue([]);
const mockDbUpdateResult = vi.fn<() => Promise<unknown>>().mockResolvedValue(undefined);

function createSelectChain() {
  const op: DbOp = { kind: "select", table: undefined };
  const chain: ProxyHandler<object> = {
    get(_, prop) {
      if (prop === "then" || prop === "catch" || prop === "finally") return undefined;
      if (prop === "from") {
        return (table: unknown) => {
          op.table = table;
          return new Proxy({}, chain);
        };
      }
      if (prop === "where") {
        return (...args: unknown[]) => {
          op.whereArgs = args;
          dbOps.push(op);
          return mockDbSelectResult();
        };
      }
      return () => new Proxy({}, chain);
    },
  };
  return new Proxy({}, chain);
}

function createUpdateChain(table: unknown) {
  const op: DbOp = { kind: "update", table };
  const chain: ProxyHandler<object> = {
    get(_, prop) {
      if (prop === "then" || prop === "catch" || prop === "finally") return undefined;
      if (prop === "set") {
        return (args: Record<string, unknown>) => {
          op.setArgs = args;
          return new Proxy({}, chain);
        };
      }
      if (prop === "where") {
        return (...args: unknown[]) => {
          op.whereArgs = args;
          dbOps.push(op);
          return mockDbUpdateResult();
        };
      }
      return () => new Proxy({}, chain);
    },
  };
  return new Proxy({}, chain);
}

const MOCK_MONITOR_ITEMS = { id: "id", status: "status", __table: "monitorItems" };

vi.mock("../../shared/db/postgres.js", () => ({
  db: {
    select: () => createSelectChain(),
    update: (table: unknown) => createUpdateChain(table),
  },
}));

vi.mock("../../shared/db/schema.js", () => ({
  monitorItems: MOCK_MONITOR_ITEMS,
}));

// ── Import real code after mocks ────────────────────────────────────────────

const { handleProcess, handleScan, enqueueProcess, enqueueScan } =
  await import("../../services/monitor/jobs.js");

// ── Helpers ─────────────────────────────────────────────────────────────────

const PROJECT_ID = "proj-test-1";
const ITEM_ID = "item-test-1";

function makeJob(projectId = PROJECT_ID, itemId = ITEM_ID) {
  return { data: { projectId, itemId } };
}

function makeScanJob(projectId = PROJECT_ID) {
  return { data: { projectId } };
}

/** Get all update operations that targeted monitorItems */
function getItemUpdates() {
  return dbOps.filter((op) => op.kind === "update" && op.table === MOCK_MONITOR_ITEMS);
}

/** Get the setup update (investigating + processing: true) */
function getSetupUpdate() {
  return getItemUpdates().find(
    (op) => op.setArgs?.status === "investigating" && op.setArgs?.processing === true,
  );
}

/** Get the cleanup update (processing: false) */
function getCleanupUpdate() {
  return getItemUpdates().find(
    (op) => op.setArgs?.processing === false && op.setArgs?.status === undefined,
  );
}

// ── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  dbOps.length = 0;
  mockDbSelectResult.mockResolvedValue([]);
  mockDbUpdateResult.mockResolvedValue(undefined);
  mockCheckBudget.mockResolvedValue(true);
  mockGetScanInterval.mockResolvedValue(300);
  mockRunInvestigation.mockResolvedValue(undefined);
  mockRunScan.mockResolvedValue(undefined);
  mockBossSend.mockResolvedValue("job-id");
  mockBossInsert.mockResolvedValue(undefined);
});

describe("handleProcess", () => {
  it("skips done items", async () => {
    mockDbSelectResult.mockResolvedValueOnce([{ status: "done" }]);
    await handleProcess(makeJob());
    expect(mockRunInvestigation).not.toHaveBeenCalled();
    expect(getItemUpdates()).toHaveLength(0);
  });

  it("skips missing items", async () => {
    mockDbSelectResult.mockResolvedValueOnce([]);
    await handleProcess(makeJob());
    expect(mockRunInvestigation).not.toHaveBeenCalled();
    expect(getItemUpdates()).toHaveLength(0);
  });

  it("skips when over budget", async () => {
    mockDbSelectResult.mockResolvedValueOnce([{ status: "queue" }]);
    mockCheckBudget.mockResolvedValue(false);
    await handleProcess(makeJob());
    expect(mockRunInvestigation).not.toHaveBeenCalled();
    expect(getItemUpdates()).toHaveLength(0);
  });

  it("sets investigating + processing before calling agent", async () => {
    mockDbSelectResult.mockResolvedValueOnce([{ status: "queue" }]);

    let agentCalledAt = -1;
    let setupUpdateIndex = -1;
    let opCounter = 0;

    // Track when each db op is recorded relative to the agent call
    const origPush = dbOps.push.bind(dbOps);
    dbOps.push = (...items: DbOp[]) => {
      for (const item of items) {
        if (item.kind === "update" && item.setArgs?.status === "investigating") {
          setupUpdateIndex = opCounter++;
        }
      }
      return origPush(...items);
    };

    mockRunInvestigation.mockImplementation(async () => {
      agentCalledAt = opCounter++;
    });

    await handleProcess(makeJob());
    // Restore original push
    dbOps.push = origPush;

    expect(setupUpdateIndex).toBeGreaterThanOrEqual(0);
    expect(agentCalledAt).toBeGreaterThan(setupUpdateIndex);
  });

  it("targets the correct item ID in all DB operations", async () => {
    mockDbSelectResult.mockResolvedValueOnce([{ status: "queue" }]);
    await handleProcess(makeJob());

    // Every DB operation should reference the item ID via eq()
    for (const op of dbOps) {
      expect(op.whereArgs).toBeDefined();
      // eq() from drizzle-orm produces an object — verify the ID value is present
      // The where clause uses eq(monitorItems.id, itemId), so the second arg to eq is the ID
      const whereStr = JSON.stringify(op.whereArgs);
      expect(whereStr).toContain(ITEM_ID);
    }
  });

  it("setup update sets investigating + processing on monitorItems", async () => {
    mockDbSelectResult.mockResolvedValueOnce([{ status: "queue" }]);
    await handleProcess(makeJob());

    const setup = getSetupUpdate();
    expect(setup).toBeDefined();
    expect(setup!.table).toBe(MOCK_MONITOR_ITEMS);
    expect(setup!.setArgs).toMatchObject({
      status: "investigating",
      processing: true,
    });
  });

  it("cleanup update clears processing on monitorItems", async () => {
    mockDbSelectResult.mockResolvedValueOnce([{ status: "queue" }]);
    await handleProcess(makeJob());

    const cleanup = getCleanupUpdate();
    expect(cleanup).toBeDefined();
    expect(cleanup!.table).toBe(MOCK_MONITOR_ITEMS);
    expect(cleanup!.setArgs).toMatchObject({ processing: false });
    // Cleanup should NOT re-set the status
    expect(cleanup!.setArgs).not.toHaveProperty("status");
  });

  it("records status_change activity on transition from queue", async () => {
    mockDbSelectResult.mockResolvedValueOnce([{ status: "queue" }]);
    await handleProcess(makeJob());

    expect(mockRecordActivity).toHaveBeenCalledWith(
      ITEM_ID,
      "status_change",
      "agent",
      { fromStatus: "queue", toStatus: "investigating" },
    );
  });

  it("skips status_change when already investigating", async () => {
    mockDbSelectResult.mockResolvedValueOnce([{ status: "investigating" }]);
    await handleProcess(makeJob());

    const statusChangeCalls = mockRecordActivity.mock.calls.filter(
      (call: unknown[]) => call[1] === "status_change",
    );
    expect(statusChangeCalls).toHaveLength(0);

    expect(mockRecordActivity).toHaveBeenCalledWith(
      ITEM_ID,
      "processing_started",
      "agent",
    );
  });

  it("records processing_started activity", async () => {
    mockDbSelectResult.mockResolvedValueOnce([{ status: "queue" }]);
    await handleProcess(makeJob());

    expect(mockRecordActivity).toHaveBeenCalledWith(
      ITEM_ID,
      "processing_started",
      "agent",
    );
  });

  it("clears processing on success", async () => {
    mockDbSelectResult.mockResolvedValueOnce([{ status: "queue" }]);
    await handleProcess(makeJob());

    const cleanup = getCleanupUpdate();
    expect(cleanup).toBeDefined();
    expect(cleanup!.setArgs).toMatchObject({ processing: false });

    expect(mockRecordActivity).toHaveBeenCalledWith(
      ITEM_ID,
      "processing_finished",
      "agent",
    );
  });

  it("clears processing on agent error", async () => {
    mockDbSelectResult.mockResolvedValueOnce([{ status: "queue" }]);
    mockRunInvestigation.mockRejectedValue(new Error("agent boom"));

    await expect(handleProcess(makeJob())).rejects.toThrow("agent boom");

    const cleanup = getCleanupUpdate();
    expect(cleanup).toBeDefined();
    expect(cleanup!.setArgs).toMatchObject({ processing: false });

    expect(mockRecordActivity).toHaveBeenCalledWith(
      ITEM_ID,
      "processing_finished",
      "agent",
    );
  });

  it("setup and cleanup are two distinct update operations", async () => {
    mockDbSelectResult.mockResolvedValueOnce([{ status: "queue" }]);
    await handleProcess(makeJob());

    const updates = getItemUpdates();
    expect(updates.length).toBeGreaterThanOrEqual(2);

    const setup = updates.find((op) => op.setArgs?.processing === true);
    const cleanup = updates.find((op) => op.setArgs?.processing === false);
    expect(setup).toBeDefined();
    expect(cleanup).toBeDefined();
    expect(setup).not.toBe(cleanup);

    // Cleanup comes after setup
    expect(updates.indexOf(cleanup!)).toBeGreaterThan(updates.indexOf(setup!));
  });

  it("emits SSE events for processing start and end", async () => {
    mockDbSelectResult.mockResolvedValueOnce([{ status: "queue" }]);
    await handleProcess(makeJob());

    const processingEvents = mockEmitMonitorEvent.mock.calls.filter(
      (call: unknown[]) => {
        const event = call[0] as Record<string, unknown>;
        return event.type === "processing";
      },
    );
    expect(processingEvents).toHaveLength(2);
    for (const [event] of processingEvents) {
      expect(event).toMatchObject({
        projectId: PROJECT_ID,
        itemId: ITEM_ID,
        type: "processing",
      });
    }
  });

  it("emits SSE events even on agent error", async () => {
    mockDbSelectResult.mockResolvedValueOnce([{ status: "queue" }]);
    mockRunInvestigation.mockRejectedValue(new Error("agent boom"));

    await expect(handleProcess(makeJob())).rejects.toThrow();

    const processingEvents = mockEmitMonitorEvent.mock.calls.filter(
      (call: unknown[]) => {
        const event = call[0] as Record<string, unknown>;
        return event.type === "processing";
      },
    );
    expect(processingEvents).toHaveLength(2);
  });

  it("re-throws agent errors for pgBoss retry", async () => {
    mockDbSelectResult.mockResolvedValueOnce([{ status: "queue" }]);
    const error = new Error("agent boom");
    mockRunInvestigation.mockRejectedValue(error);

    await expect(handleProcess(makeJob())).rejects.toThrow(error);
  });

  it("calls runInvestigation with correct projectId and itemId", async () => {
    mockDbSelectResult.mockResolvedValueOnce([{ status: "queue" }]);
    await handleProcess(makeJob());

    expect(mockRunInvestigation).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      itemId: ITEM_ID,
    });
  });

  it("checks budget with the correct projectId", async () => {
    mockDbSelectResult.mockResolvedValueOnce([{ status: "queue" }]);
    await handleProcess(makeJob());

    expect(mockCheckBudget).toHaveBeenCalledWith(PROJECT_ID);
  });
});

describe("handleScan", () => {
  it("skips when over budget", async () => {
    mockCheckBudget.mockResolvedValue(false);
    await handleScan(makeScanJob());
    expect(mockRunScan).not.toHaveBeenCalled();
  });

  it("runs scan when budget ok", async () => {
    mockCheckBudget.mockResolvedValue(true);
    await handleScan(makeScanJob());
    expect(mockRunScan).toHaveBeenCalledWith(PROJECT_ID);
  });

  it("checks budget with the correct projectId", async () => {
    await handleScan(makeScanJob());
    expect(mockCheckBudget).toHaveBeenCalledWith(PROJECT_ID);
  });

  it("propagates runScan errors for pgBoss retry", async () => {
    mockCheckBudget.mockResolvedValue(true);
    const error = new Error("scan boom");
    mockRunScan.mockRejectedValue(error);

    await expect(handleScan(makeScanJob())).rejects.toThrow(error);
  });
});

describe("enqueueProcess", () => {
  it("uses singletonKey for debounced enqueue", async () => {
    await enqueueProcess(PROJECT_ID, ITEM_ID, true);
    expect(mockBossSend).toHaveBeenCalledWith(
      "monitor-process",
      { projectId: PROJECT_ID, itemId: ITEM_ID },
      expect.objectContaining({
        singletonKey: ITEM_ID,
        singletonSeconds: 60,
      }),
    );
  });

  it("uses boss.insert for non-debounced enqueue", async () => {
    await enqueueProcess(PROJECT_ID, ITEM_ID, false);
    expect(mockBossInsert).toHaveBeenCalledWith([
      { name: "monitor-process", data: { projectId: PROJECT_ID, itemId: ITEM_ID } },
    ]);
  });

  it("does not throw when debounced enqueue is deduplicated", async () => {
    mockBossSend.mockResolvedValue(null); // pgBoss returns null when deduplicated
    await expect(enqueueProcess(PROJECT_ID, ITEM_ID, true)).resolves.not.toThrow();
  });
});

describe("enqueueScan", () => {
  it("uses project scan interval as singleton window", async () => {
    mockGetScanInterval.mockResolvedValue(600);
    await enqueueScan(PROJECT_ID);
    expect(mockBossSend).toHaveBeenCalledWith(
      "monitor-scan",
      { projectId: PROJECT_ID },
      expect.objectContaining({
        singletonKey: PROJECT_ID,
        singletonSeconds: 600,
      }),
    );
  });
});
