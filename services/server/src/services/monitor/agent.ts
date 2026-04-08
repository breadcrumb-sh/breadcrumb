/**
 * Monitor investigation runner — thin wrapper that wires up the agent, handlers, and model.
 *
 * The agent uses a scratchpad note on the ticket for its working state (research plan,
 * findings, TODOs) and comments only for communicating concise results to the developer.
 */

import { generateText, stepCountIs } from "ai";
import { eq } from "drizzle-orm";
import { getAiModel } from "../explore/ai-provider.js";
import { db } from "../../shared/db/postgres.js";
import { monitorItems, monitorComments, monitorLabels, project } from "../../shared/db/schema.js";
import { createLogger } from "../../shared/lib/logger.js";
import { getTelemetry } from "../../shared/lib/breadcrumb.js";
import { trackMonitorInvestigationCompleted } from "../../shared/lib/telemetry.js";
import { recordUsage } from "./usage.js";
import { emitMonitorEvent } from "./events.js";
import { buildInvestigatePrompt, createInvestigateTools } from "./investigate-agent.js";
import {
  createProductionInvestigateHandlers,
  tryCreateRepoHandlers,
} from "./investigate-handlers.js";
import { getInstallationForProject } from "../github/installations.js";

const log = createLogger("monitor-agent");

export interface InvestigateOptions {
  projectId: string;
  itemId: string;
}

export async function runInvestigation({ projectId, itemId }: InvestigateOptions) {
  const [item] = await db
    .select()
    .from(monitorItems)
    .where(eq(monitorItems.id, itemId));

  if (!item) {
    log.warn({ itemId }, "monitor item not found");
    return;
  }

  let model;
  try {
    model = await getAiModel(projectId);
  } catch {
    log.warn({ projectId }, "no AI provider configured — skipping investigation");
    await addAgentComment(projectId, itemId, "Cannot investigate — no AI provider configured for this project.");
    return;
  }

  const [proj] = await db
    .select({ agentMemory: project.agentMemory })
    .from(project)
    .where(eq(project.id, projectId));

  const comments = await db
    .select()
    .from(monitorComments)
    .where(eq(monitorComments.monitorItemId, itemId))
    .orderBy(monitorComments.createdAt);

  const labels = await db
    .select({ name: monitorLabels.name })
    .from(monitorLabels)
    .where(eq(monitorLabels.projectId, projectId));

  const state = {
    memory: proj?.agentMemory ?? "",
    note: item.note ?? "",
    status: item.status,
  };

  // Try to attach repo-reading tools. If the project hasn't connected
  // GitHub (or the installation is suspended), this returns null and the
  // tools simply aren't exposed to the agent.
  const repoHandlers = await tryCreateRepoHandlers(projectId);
  const installation = repoHandlers
    ? await getInstallationForProject(projectId)
    : null;
  const connectedRepos =
    installation?.trackedRepos.map((r) => ({ fullName: r.fullName })) ?? [];

  const handlers = createProductionInvestigateHandlers(
    projectId,
    itemId,
    state,
    model,
    repoHandlers,
  );

  const { system, messages } = buildInvestigatePrompt({
    projectMemory: state.memory,
    item: {
      title: item.title,
      description: item.description ?? "",
      status: item.status,
      note: state.note,
    },
    comments: comments.map((c) => ({ source: c.source as "user" | "agent", content: c.content })),
    availableLabels: labels.map((l) => l.name),
    connectedRepos,
  });

  const tools = createInvestigateTools(handlers);

  log.info({ projectId, itemId }, "starting investigation");

  try {
    const result = await generateText({
      model,
      system,
      messages,
      temperature: 0,
      stopWhen: [
        stepCountIs(30),
        async () => {
          const [current] = await db
            .select({ status: monitorItems.status })
            .from(monitorItems)
            .where(eq(monitorItems.id, itemId));
          if (!current || current.status === "done") {
            log.info({ itemId }, "item cancelled — stopping investigation");
            return true;
          }
          return false;
        },
      ],
      experimental_telemetry: getTelemetry("monitor-investigate", { itemId, projectId }),
      tools,
    });

    const input = result.usage?.inputTokens ?? 0;
    const output = result.usage?.outputTokens ?? 0;
    const costCents = Math.ceil((input * 3 + output * 15) / 1_000_000 * 100);
    await recordUsage(projectId, input, output, costCents);

    // Read final status for telemetry
    const [final] = await db
      .select({ status: monitorItems.status })
      .from(monitorItems)
      .where(eq(monitorItems.id, itemId));
    trackMonitorInvestigationCompleted(final?.status ?? "unknown", costCents);

    log.info({ projectId, itemId, inputTokens: input, outputTokens: output, costCents }, "investigation complete");
  } catch (err) {
    log.error({ projectId, itemId, err }, "investigation failed");
    await addAgentComment(
      projectId, itemId,
      `Investigation encountered an error: ${err instanceof Error ? err.message : "Unknown error"}`,
    );
  }
}

async function addAgentComment(projectId: string, itemId: string, content: string) {
  await db.insert(monitorComments).values({
    monitorItemId: itemId,
    source: "agent",
    content,
  });
  await db
    .update(monitorItems)
    .set({ read: false, updatedAt: new Date() })
    .where(eq(monitorItems.id, itemId));
  emitMonitorEvent({ projectId, itemId, type: "comment" });
}
