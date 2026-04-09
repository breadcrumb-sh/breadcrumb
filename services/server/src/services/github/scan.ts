/**
 * Repo scan runner — thin wrapper that wires up the scan agent, handlers,
 * and model. Mirrors the shape of `monitor/scan.ts`.
 *
 * Triggering is out of scope for this file. Callers invoke `runRepoScan`
 * directly (from a tRPC mutation, a test script, or — later — an event
 * hook on first repo connection).
 */

import { generateText, stepCountIs } from "ai";
import { eq } from "drizzle-orm";
import { getAiModelWithMeta } from "../explore/ai-provider.js";
import { db } from "../../shared/db/postgres.js";
import { project } from "../../shared/db/schema.js";
import { createLogger } from "../../shared/lib/logger.js";
import { getTelemetry } from "../../shared/lib/breadcrumb.js";
import { checkBudget, recordUsage } from "../monitor/usage.js";
import { computeRunCostCents } from "../cost/rate-lookup.js";
import { extractUsage } from "../cost/usage-extract.js";
import { getInstallationForProject } from "./installations.js";
import { createRepoToolHandlers } from "./repo-tool-handlers.js";
import { buildRepoScanPrompt, createRepoScanTools } from "./scan-agent.js";
import { createProductionRepoScanHandlers } from "./scan-handlers.js";

const log = createLogger("repo-scan");

export interface RepoScanResult {
  status: "success" | "skipped" | "error";
  costCents: number;
  inputTokens?: number;
  outputTokens?: number;
  errorMessage?: string;
}

export async function runRepoScan(projectId: string): Promise<RepoScanResult> {
  // Same gate used by the trace scan and investigation runners: skip if
  // the project has hit its monthly cost limit. A limit of 0 means
  // unlimited. This lets the cost ceiling cover repo scans too without
  // introducing a parallel tracking system.
  if (!(await checkBudget(projectId))) {
    log.info({ projectId }, "skipping repo scan — monthly cost limit reached");
    return {
      status: "skipped",
      costCents: 0,
      errorMessage:
        "Monthly agent cost limit reached for this project. Raise the limit in project settings to run another scan.",
    };
  }

  let model;
  let modelId: string;
  try {
    const meta = await getAiModelWithMeta(projectId);
    model = meta.model;
    modelId = meta.modelId;
  } catch {
    log.warn({ projectId }, "no AI provider configured — skipping repo scan");
    return {
      status: "skipped",
      costCents: 0,
      errorMessage: "No AI provider configured for this project.",
    };
  }

  const installation = await getInstallationForProject(projectId);
  if (!installation) {
    return {
      status: "skipped",
      costCents: 0,
      errorMessage: "No GitHub installation linked to this project.",
    };
  }
  if (installation.suspendedAt) {
    return {
      status: "skipped",
      costCents: 0,
      errorMessage: "GitHub installation is suspended. Reconnect to run a scan.",
    };
  }
  if (installation.trackedRepos.length === 0) {
    return {
      status: "skipped",
      costCents: 0,
      errorMessage: "No repositories tracked for this project.",
    };
  }

  const repoTools = await createRepoToolHandlers(projectId);

  const [proj] = await db
    .select({ agentMemory: project.agentMemory })
    .from(project)
    .where(eq(project.id, projectId));

  const state = { memory: proj?.agentMemory ?? "" };
  const handlers = createProductionRepoScanHandlers(projectId, state, repoTools);

  const { system, prompt } = buildRepoScanPrompt({
    projectMemory: state.memory,
    connectedRepos: installation.trackedRepos.map((r) => ({
      fullName: r.fullName,
      defaultBranch: r.defaultBranch,
    })),
  });

  const tools = createRepoScanTools(handlers);

  log.info(
    {
      projectId,
      repoCount: installation.trackedRepos.length,
      repos: installation.trackedRepos.map((r) => r.fullName),
    },
    "starting repo scan",
  );

  try {
    const result = await generateText({
      model,
      system,
      prompt,
      temperature: 0,
      stopWhen: stepCountIs(40),
      experimental_telemetry: getTelemetry("repo-scan", { projectId }),
      tools,
    });

    const usage = extractUsage(result.usage);
    const costCents = await computeRunCostCents(projectId, modelId, usage);
    await recordUsage(projectId, usage.inputTokens, usage.outputTokens, costCents);

    log.info(
      {
        projectId,
        modelId,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        costCents,
      },
      "repo scan complete",
    );

    return {
      status: "success",
      costCents,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    };
  } catch (err) {
    log.error({ projectId, err }, "repo scan failed");
    return {
      status: "error",
      costCents: 0,
      errorMessage: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
