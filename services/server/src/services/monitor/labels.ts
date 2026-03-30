import { db } from "../../shared/db/postgres.js";
import { monitorLabels } from "../../shared/db/schema.js";

export const DEFAULT_LABELS = [
  { name: "bug", color: "#ef4444" },
  { name: "performance", color: "#f59e0b" },
  { name: "cost", color: "#8b5cf6" },
  { name: "quality", color: "#3b82f6" },
  { name: "pattern", color: "#06b6d4" },
  { name: "security", color: "#ec4899" },
];

export async function createDefaultLabels(projectId: string) {
  await db.insert(monitorLabels).values(
    DEFAULT_LABELS.map((l) => ({ projectId, ...l })),
  );
}
