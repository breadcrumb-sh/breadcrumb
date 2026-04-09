/**
 * Monitor scan runner — thin wrapper that wires up the agent, handlers, and model.
 *
 * Triggered by trace ingestion (debounced). The agent queries traces on its own,
 * uses project memory for context, and creates tickets for anything worth looking into.
 */

import { generateText, stepCountIs } from "ai";
import { eq, desc, and, ne } from "drizzle-orm";
import { getAiModelWithMeta } from "../explore/ai-provider.js";
import { db } from "../../shared/db/postgres.js";
import { project, monitorScanRuns } from "../../shared/db/schema.js";
import { createLogger } from "../../shared/lib/logger.js";
import { getTelemetry } from "../../shared/lib/breadcrumb.js";
import { trackMonitorScanCompleted } from "../../shared/lib/telemetry.js";
import { recordUsage } from "./usage.js";
import { computeRunCostCents } from "../cost/rate-lookup.js";
import { extractUsage } from "../cost/usage-extract.js";
import { buildScanPrompt, createScanTools } from "./scan-agent.js";
import { createProductionScanHandlers, type ScanStats } from "./scan-handlers.js";

const log = createLogger("monitor-scan");

export interface ScanResult {
  status: "success" | "empty" | "skipped" | "error";
  ticketsCreated: number;
  costCents: number;
  errorMessage?: string;
}

export async function runScan(projectId: string): Promise<ScanResult> {
  let model;
  let modelId: string;
  try {
    const meta = await getAiModelWithMeta(projectId);
    model = meta.model;
    modelId = meta.modelId;
  } catch {
    log.warn({ projectId }, "no AI provider configured — skipping scan");
    return { status: "skipped", ticketsCreated: 0, costCents: 0, errorMessage: "No AI provider configured" };
  }

  const [proj] = await db
    .select({ agentMemory: project.agentMemory })
    .from(project)
    .where(eq(project.id, projectId));

  // Find the previous completed scan to scope queries
  const [prevRun] = await db
    .select({ startedAt: monitorScanRuns.startedAt })
    .from(monitorScanRuns)
    .where(and(
      eq(monitorScanRuns.projectId, projectId),
      ne(monitorScanRuns.status, "running"),
    ))
    .orderBy(desc(monitorScanRuns.startedAt))
    .limit(1);

  const state = { memory: proj?.agentMemory ?? "" };
  const stats: ScanStats = { queryCount: 0, ticketCount: 0 };
  const handlers = createProductionScanHandlers(projectId, state, model, stats);
  const { system, prompt } = buildScanPrompt({
    projectMemory: state.memory,
    lastScanAt: prevRun?.startedAt ?? null,
  });
  const tools = createScanTools(handlers);

  log.info({ projectId }, "starting scan");

  try {
    const result = await generateText({
      model,
      system,
      prompt,
      temperature: 0,
      stopWhen: stepCountIs(15),
      experimental_telemetry: getTelemetry("monitor-scan", { projectId }),
      tools,
    });

    const usage = extractUsage(result.usage);
    const costCents = await computeRunCostCents(projectId, modelId, usage);
    await recordUsage(projectId, usage.inputTokens, usage.outputTokens, costCents);
    trackMonitorScanCompleted(stats.ticketCount, stats.queryCount, costCents);
    log.info(
      {
        projectId,
        modelId,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        costCents,
      },
      "scan complete",
    );

    return {
      status: stats.ticketCount > 0 ? "success" : "empty",
      ticketsCreated: stats.ticketCount,
      costCents,
    };
  } catch (err) {
    log.error({ projectId, err }, "scan failed");
    return {
      status: "error",
      ticketsCreated: 0,
      costCents: 0,
      errorMessage: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
