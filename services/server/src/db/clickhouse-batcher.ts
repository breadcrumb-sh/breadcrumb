import type { ClickHouseClient } from "@clickhouse/client";

export class ClickHouseBatcher<T extends Record<string, unknown>> {
  private buffer: T[] = [];
  private timer: ReturnType<typeof setInterval>;

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
    if (this.buffer.length === 0) return;

    const batch = this.buffer;
    this.buffer = [];

    try {
      await this.client.insert({
        table: this.table,
        format: "JSONEachRow",
        values: batch,
      });
      console.log(`[batcher] flushed ${batch.length} rows to ${this.table}`);
    } catch (err) {
      console.error(`[batcher] failed to flush ${batch.length} rows to ${this.table}:`, err);
    }
  }

  async shutdown() {
    clearInterval(this.timer);
    await this.flush();
  }
}
