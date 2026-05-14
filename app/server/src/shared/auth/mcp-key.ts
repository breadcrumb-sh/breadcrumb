import { eq } from "drizzle-orm";
import { db } from "../db/postgres.js";
import { mcpKeys } from "../db/schema.js";
import { hashApiKey } from "../lib/api-keys.js";
import type { Context, Next } from "hono";

const KEY_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const mcpKeyCache = new Map<string, { userId: string; expiresAt: number }>();

async function resolveMcpKey(hash: string): Promise<string | null> {
  const cached = mcpKeyCache.get(hash);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.userId;
  }

  const [found] = await db
    .select({ userId: mcpKeys.userId })
    .from(mcpKeys)
    .where(eq(mcpKeys.keyHash, hash))
    .limit(1);

  if (!found) {
    mcpKeyCache.delete(hash);
    return null;
  }

  mcpKeyCache.set(hash, {
    userId: found.userId,
    expiresAt: Date.now() + KEY_CACHE_TTL,
  });
  return found.userId;
}

export async function requireMcpKey(c: Context, next: Next) {
  const header = c.req.header("Authorization");
  const key = header?.startsWith("Bearer ") ? header.slice(7) : null;

  if (!key) {
    return c.json({ error: "Missing MCP key" }, 401);
  }

  const userId = await resolveMcpKey(hashApiKey(key));
  if (!userId) {
    return c.json({ error: "Invalid MCP key" }, 401);
  }

  c.set("userId", userId);
  await next();
}
