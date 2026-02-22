import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { apiKeys, mcpKeys } from "../db/schema.js";
import { hashApiKey } from "../lib/api-keys.js";
import type { Context, Next } from "hono";

// ── API key auth ─────────────────────────────────────────────────────

const KEY_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const keyCache = new Map<string, { projectId: string; expiresAt: number }>();

async function resolveApiKey(hash: string): Promise<string | null> {
  const cached = keyCache.get(hash);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.projectId;
  }

  const [found] = await db
    .select({ projectId: apiKeys.projectId })
    .from(apiKeys)
    .where(eq(apiKeys.keyHash, hash))
    .limit(1);

  if (!found) {
    keyCache.delete(hash);
    return null;
  }

  keyCache.set(hash, {
    projectId: found.projectId,
    expiresAt: Date.now() + KEY_CACHE_TTL,
  });
  return found.projectId;
}

export async function requireApiKey(c: Context, next: Next) {
  const header = c.req.header("Authorization");
  const key = header?.startsWith("Bearer ") ? header.slice(7) : null;

  if (!key) {
    return c.json({ error: "Missing API key" }, 401);
  }

  const projectId = await resolveApiKey(hashApiKey(key));
  if (!projectId) {
    return c.json({ error: "Invalid API key" }, 401);
  }

  c.set("projectId", projectId);
  await next();
}

// ── MCP key auth ─────────────────────────────────────────────────────

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
