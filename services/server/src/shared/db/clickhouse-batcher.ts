import type { ClickHouseClient } from "@clickhouse/client";
import { createLogger } from "../lib/logger.js";

const log = createLogger("batcher");

export class ClickHouseBatcher<T extends Record<string, unknown>> {
  private buffer: T[] = [];
  private timer: ReturnType<typeof setInterval>;
  private retryBatch: T[] | null = null;

  constructor(
    private client: ClickHouseClient,
    private table: string,
    private maxSize = 500,
    private maxWaitMs = 1_000,
  ) {
    this.timer = setInterval(() => this.flush(), this.maxWaitMs);
  }

  add(rows: T[]) {
    this.buffer.push(...rows);
    if (this.buffer.length >= this.maxSize) {
      void this.flush();
    }
  }

  async flush() {
    // Retry the previous failed batch first
    if (this.retryBatch) {
      const retry = this.retryBatch;
      this.retryBatch = null;
      try {
        await this.client.insert({
          table: this.table,
          format: "JSONEachRow",
          values: retry,
        });
      } catch (err) {
        // Second failure — data is lost
        log.error({ err, table: this.table, rows: retry.length }, "retry failed, dropping rows");
      }
    }

    if (this.buffer.length === 0) return;

    const batch = this.buffer;
    this.buffer = [];

    try {
      await this.client.insert({
        table: this.table,
        format: "JSONEachRow",
        values: batch,
      });
    } catch (err) {
      log.error({ err, table: this.table, rows: batch.length }, "flush failed, will retry");
      this.retryBatch = batch;
    }
  }

  async shutdown() {
    clearInterval(this.timer);
    await this.flush();
  }
}
