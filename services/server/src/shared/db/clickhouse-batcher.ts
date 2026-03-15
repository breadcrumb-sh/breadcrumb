import type { ClickHouseClient } from "@clickhouse/client";

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
        console.error(`[batcher] retry failed, dropping ${retry.length} rows from ${this.table}:`, err);
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
      console.error(`[batcher] flush failed for ${batch.length} rows to ${this.table}, will retry:`, err);
      this.retryBatch = batch;
    }
  }

  async shutdown() {
    clearInterval(this.timer);
    await this.flush();
  }
}
