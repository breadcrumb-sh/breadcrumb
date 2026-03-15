import { eq, and } from "drizzle-orm";
import { db } from "../../shared/db/postgres.js";
import { observations } from "../../shared/db/schema.js";

type Observation = typeof observations.$inferSelect;

const cache = new Map<string, { data: Observation[]; fetchedAt: number }>();
const TTL_MS = 60_000;

export async function getObservationsForProject(projectId: string): Promise<Observation[]> {
  const cached = cache.get(projectId);
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) {
    return cached.data;
  }

  const data = await db
    .select()
    .from(observations)
    .where(and(eq(observations.projectId, projectId), eq(observations.enabled, true)));

  cache.set(projectId, { data, fetchedAt: Date.now() });
  return data;
}

export function invalidateObservationsCache(projectId: string): void {
  cache.delete(projectId);
}
