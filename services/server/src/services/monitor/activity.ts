import { db } from "../../shared/db/postgres.js";
import { monitorActivity } from "../../shared/db/schema.js";

export type ActivityType =
  | "created"
  | "status_change"
  | "processing_started"
  | "processing_finished";

export type ActivityActor = "user" | "agent" | "system";

export async function recordActivity(
  monitorItemId: string,
  type: ActivityType,
  actor: ActivityActor = "system",
  opts?: { fromStatus?: string; toStatus?: string; actorId?: string },
) {
  await db.insert(monitorActivity).values({
    monitorItemId,
    type,
    actor,
    actorId: opts?.actorId ?? null,
    fromStatus: opts?.fromStatus ?? null,
    toStatus: opts?.toStatus ?? null,
  });
}
