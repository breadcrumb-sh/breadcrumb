import { createHash } from "node:crypto";
import { eq, lt } from "drizzle-orm";
import type { z } from "zod";
import { db } from "../db/index.js";
import { cache as cacheTable } from "../db/schema.js";

/**
 * Generic Postgres-backed cache with Zod validation and TTL expiry.
 *
 * Usage:
 *   const result = await cache.get("prefix", inputKey, schema);
 *   if (result !== null) return result;
 *   const fresh = await expensiveCall();
 *   await cache.set("prefix", inputKey, fresh, ttlMs);
 */
export const cache = {
  /**
   * Get a cached value. Returns null on miss, expiry, or validation failure.
   * `inputKey` is hashed — pass any serializable value (string, object, etc.).
   */
  async get<T>(
    prefix: string,
    inputKey: unknown,
    schema: z.ZodType<T>
  ): Promise<T | null> {
    const key = buildKey(prefix, inputKey);
    const [row] = await db
      .select({ value: cacheTable.value, expiresAt: cacheTable.expiresAt })
      .from(cacheTable)
      .where(eq(cacheTable.key, key));

    if (!row || row.expiresAt < new Date()) return null;

    const parsed = schema.safeParse(row.value);
    return parsed.success ? parsed.data : null;
  },

  /**
   * Store a value in the cache. Upserts on key conflict.
   */
  async set(
    prefix: string,
    inputKey: unknown,
    value: unknown,
    ttlMs: number
  ): Promise<void> {
    const key = buildKey(prefix, inputKey);
    const expiresAt = new Date(Date.now() + ttlMs);

    await db
      .insert(cacheTable)
      .values({ key, value, expiresAt })
      .onConflictDoUpdate({
        target: cacheTable.key,
        set: { value, expiresAt },
      });
  },

  /**
   * Delete all expired entries. Call this periodically.
   */
  async cleanup(): Promise<number> {
    const result = await db
      .delete(cacheTable)
      .where(lt(cacheTable.expiresAt, new Date()))
      .returning({ key: cacheTable.key });
    return result.length;
  },
};

function buildKey(prefix: string, inputKey: unknown): string {
  const raw = typeof inputKey === "string" ? inputKey : JSON.stringify(inputKey);
  const hash = createHash("sha256").update(raw).digest("hex").slice(0, 32);
  return `${prefix}:${hash}`;
}
