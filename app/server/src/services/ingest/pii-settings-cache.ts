/**
 * In-memory cache for PII redaction settings per project.
 * Avoids hitting Postgres on the hot ingestion path.
 */

import { eq } from "drizzle-orm";
import { db } from "../../shared/db/postgres.js";
import { piiRedactionSettings, piiCustomPatterns } from "../../shared/db/schema.js";
import {
  buildRedactor,
  type CompiledRedactor,
  type BuiltInPiiType,
  type PiiToggles,
} from "./pii-redactor.js";

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

type CacheEntry = {
  redactor: CompiledRedactor | null;
  expiresAt: number;
};

const cache = new Map<string, CacheEntry>();

const TOGGLE_COLUMNS: BuiltInPiiType[] = [
  "email", "phone", "ssn", "creditCard", "ipAddress",
  "dateOfBirth", "usAddress", "apiKey", "url",
];

export async function getRedactor(projectId: string): Promise<CompiledRedactor | null> {
  const cached = cache.get(projectId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.redactor;
  }

  const [settings] = await db
    .select()
    .from(piiRedactionSettings)
    .where(eq(piiRedactionSettings.projectId, projectId))
    .limit(1);

  if (!settings) {
    cache.set(projectId, { redactor: null, expiresAt: Date.now() + CACHE_TTL });
    return null;
  }

  const toggles: PiiToggles = {};
  for (const col of TOGGLE_COLUMNS) {
    toggles[col] = settings[col] as boolean;
  }

  const customs = await db
    .select()
    .from(piiCustomPatterns)
    .where(eq(piiCustomPatterns.projectId, projectId));

  const redactor = buildRedactor(
    toggles,
    customs.map((c) => ({ pattern: c.pattern, replacement: c.replacement, enabled: c.enabled })),
  );

  cache.set(projectId, { redactor, expiresAt: Date.now() + CACHE_TTL });
  return redactor;
}

export function invalidateRedactionCache(projectId: string): void {
  cache.delete(projectId);
}
