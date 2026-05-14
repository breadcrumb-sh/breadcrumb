import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../shared/lib/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("../../shared/lib/telemetry.js", () => ({
  trackSlowIngestBatch: vi.fn(),
}));

import { ClickHouseBatcher } from "../../shared/db/clickhouse-batcher.js";

type Row = { id: number };

const mockInsert = vi.fn();

function makeBatcher(maxSize = 5, maxWaitMs = 1_000) {
  const client = { insert: mockInsert } as any;
  return new ClickHouseBatcher<Row>(client, "test_table", maxSize, maxWaitMs);
}

beforeEach(() => {
  vi.useFakeTimers();
  mockInsert.mockReset();
  mockInsert.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ClickHouseBatcher", () => {
  it("add() buffers rows without flushing immediately", () => {
    const batcher = makeBatcher();
    batcher.add([{ id: 1 }]);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("flush() calls client.insert with buffered rows", async () => {
    const batcher = makeBatcher();
    batcher.add([{ id: 1 }, { id: 2 }]);
    await batcher.flush();
    expect(mockInsert).toHaveBeenCalledWith({
      table: "test_table",
      format: "JSONEachRow",
      values: [{ id: 1 }, { id: 2 }],
    });
  });

  it("flush() clears the buffer after successful insert", async () => {
    const batcher = makeBatcher();
    batcher.add([{ id: 1 }]);
    await batcher.flush();
    mockInsert.mockClear();
    await batcher.flush();
    // Second flush should be a no-op (buffer empty)
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("flush() on empty buffer is a no-op", async () => {
    const batcher = makeBatcher();
    await batcher.flush();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("automatic flush triggers when buffer reaches maxSize", () => {
    const batcher = makeBatcher(3);
    batcher.add([{ id: 1 }, { id: 2 }, { id: 3 }]);
    // flush is called internally via void this.flush()
    expect(mockInsert).toHaveBeenCalledTimes(1);
  });

  it("timer-based flush triggers after maxWaitMs", async () => {
    const batcher = makeBatcher(100, 500);
    batcher.add([{ id: 1 }]);
    expect(mockInsert).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    // setInterval fires, triggering flush
    expect(mockInsert).toHaveBeenCalledTimes(1);
  });

  it("failed flush stores batch for retry", async () => {
    const batcher = makeBatcher();
    batcher.add([{ id: 1 }]);
    mockInsert.mockRejectedValueOnce(new Error("network error"));
    await batcher.flush();
    // Insert was called once and failed
    expect(mockInsert).toHaveBeenCalledTimes(1);

    // Next flush should retry the failed batch
    mockInsert.mockClear();
    mockInsert.mockResolvedValue(undefined);
    await batcher.flush();
    expect(mockInsert).toHaveBeenCalledWith({
      table: "test_table",
      format: "JSONEachRow",
      values: [{ id: 1 }],
    });
  });

  it("retry succeeds on next flush", async () => {
    const batcher = makeBatcher();
    batcher.add([{ id: 1 }]);
    mockInsert.mockRejectedValueOnce(new Error("fail"));
    await batcher.flush();

    // Now add new rows and flush again — retry should go first
    batcher.add([{ id: 2 }]);
    mockInsert.mockClear();
    mockInsert.mockResolvedValue(undefined);
    await batcher.flush();

    // Two insert calls: one for retry, one for new buffer
    expect(mockInsert).toHaveBeenCalledTimes(2);
    expect(mockInsert).toHaveBeenNthCalledWith(1, {
      table: "test_table",
      format: "JSONEachRow",
      values: [{ id: 1 }],
    });
    expect(mockInsert).toHaveBeenNthCalledWith(2, {
      table: "test_table",
      format: "JSONEachRow",
      values: [{ id: 2 }],
    });
  });

  it("retry failure drops the batch (second failure = data lost)", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const batcher = makeBatcher();
    batcher.add([{ id: 1 }]);

    // First flush fails — stores for retry
    mockInsert.mockRejectedValueOnce(new Error("fail1"));
    await batcher.flush();

    // Second flush also fails on retry — data is dropped
    mockInsert.mockRejectedValueOnce(new Error("fail2"));
    await batcher.flush();

    // Third flush: no retry batch, no buffer — nothing happens
    mockInsert.mockClear();
    await batcher.flush();
    expect(mockInsert).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("shutdown() clears timer and flushes remaining rows", async () => {
    const batcher = makeBatcher();
    batcher.add([{ id: 1 }]);
    await batcher.shutdown();
    expect(mockInsert).toHaveBeenCalledTimes(1);
    // After shutdown, timer should not fire again
    mockInsert.mockClear();
    vi.advanceTimersByTime(5_000);
    expect(mockInsert).not.toHaveBeenCalled();
  });
});
