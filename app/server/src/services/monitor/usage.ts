/**
 * Agent usage tracking and budget enforcement.
 */

import { eq, and, sql } from "drizzle-orm";
import { db } from "../../shared/db/postgres.js";
import { agentUsage, project } from "../../shared/db/schema.js";
import { createLogger } from "../../shared/lib/logger.js";

const log = createLogger("monitor-usage");

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

/**
 * Check if the project has budget remaining for this month.
 * Returns true if the agent can proceed, false if over limit.
 */
export async function checkBudget(projectId: string): Promise<boolean> {
  const [proj] = await db
    .select({ limit: project.agentMonthlyCostLimitCents })
    .from(project)
    .where(eq(project.id, projectId));

  if (!proj || proj.limit === 0) return true; // 0 = unlimited

  const [usage] = await db
    .select({ costCents: agentUsage.costCents })
    .from(agentUsage)
    .where(and(eq(agentUsage.projectId, projectId), eq(agentUsage.month, currentMonth())));

  const spent = usage?.costCents ?? 0;
  const withinBudget = spent < proj.limit;

  if (!withinBudget) {
    log.info({ projectId, spentCents: spent, limitCents: proj.limit }, "monthly cost limit reached");
  }

  return withinBudget;
}

/**
 * Get the configured scan interval for a project.
 */
export async function getScanInterval(projectId: string): Promise<number> {
  const [proj] = await db
    .select({ interval: project.agentScanIntervalSeconds })
    .from(project)
    .where(eq(project.id, projectId));
  return proj?.interval ?? 300;
}

/**
 * Record usage from an AI SDK generateText call.
 */
export async function recordUsage(
  projectId: string,
  inputTokens: number,
  outputTokens: number,
  costCents: number,
) {
  const month = currentMonth();

  await db
    .insert(agentUsage)
    .values({ projectId, month, inputTokens, outputTokens, costCents, calls: 1 })
    .onConflictDoUpdate({
      target: [agentUsage.projectId, agentUsage.month],
      set: {
        inputTokens: sql`${agentUsage.inputTokens} + ${inputTokens}`,
        outputTokens: sql`${agentUsage.outputTokens} + ${outputTokens}`,
        costCents: sql`${agentUsage.costCents} + ${costCents}`,
        calls: sql`${agentUsage.calls} + 1`,
      },
    });
}
