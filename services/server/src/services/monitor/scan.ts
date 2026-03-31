/**
 * Monitor scan runner — thin wrapper that wires up the agent, handlers, and model.
 *
 * Triggered by trace ingestion (debounced). The agent queries traces on its own,
 * uses project memory for context, and creates tickets for anything worth looking into.
 */

import { generateText, stepCountIs } from "ai";
import { eq } from "drizzle-orm";
import { getAiModel } from "../explore/ai-provider.js";
import { db } from "../../shared/db/postgres.js";
import { project } from "../../shared/db/schema.js";
import { createLogger } from "../../shared/lib/logger.js";
import { getTelemetry } from "../../shared/lib/breadcrumb.js";
import { recordUsage } from "./usage.js";
import { buildScanPrompt, createScanTools } from "./scan-agent.js";
import { createProductionScanHandlers } from "./scan-handlers.js";

const log = createLogger("monitor-scan");

export async function runScan(projectId: string) {
  let model;
  try {
    model = await getAiModel(projectId);
  } catch {
    log.warn({ projectId }, "no AI provider configured — skipping scan");
    return;
  }

  const [proj] = await db
    .select({ agentMemory: project.agentMemory })
    .from(project)
    .where(eq(project.id, projectId));

  const state = { memory: proj?.agentMemory ?? "" };
  const handlers = createProductionScanHandlers(projectId, state);
  const { system, prompt } = buildScanPrompt({ projectMemory: state.memory });
  const tools = createScanTools(handlers);

  log.info({ projectId }, "starting scan");

  try {
    const result = await generateText({
      model,
      system,
      prompt,
      temperature: 0,
      stopWhen: stepCountIs(40),
      experimental_telemetry: getTelemetry("monitor-scan", { projectId }),
      tools,
    });

    const input = result.usage?.inputTokens ?? 0;
    const output = result.usage?.outputTokens ?? 0;
    const costCents = Math.ceil((input * 3 + output * 15) / 1_000_000 * 100);
    await recordUsage(projectId, input, output, costCents);
    log.info({ projectId, inputTokens: input, outputTokens: output, costCents }, "scan complete");
  } catch (err) {
    log.error({ projectId, err }, "scan failed");
  }
}
