/**
 * Production tool handlers for the repo scan agent.
 *
 * Memory writer methods write to `project.agentMemory` — the SAME field
 * the trace scan agent writes to. That's intentional: one shared memory
 * document, augmented by both agents.
 */

import { eq } from "drizzle-orm";
import { db } from "../../shared/db/postgres.js";
import { project } from "../../shared/db/schema.js";
import { createLogger } from "../../shared/lib/logger.js";
import type { RepoToolHandlers } from "./repo-tools.js";
import type { RepoScanToolHandlers } from "./scan-agent.js";

const log = createLogger("repo-scan");

export function createProductionRepoScanHandlers(
  projectId: string,
  state: { memory: string },
  repoTools: RepoToolHandlers,
): RepoScanToolHandlers {
  return {
    repo: repoTools,

    async writeMemory(content) {
      await db
        .update(project)
        .set({ agentMemory: content })
        .where(eq(project.id, projectId));
      state.memory = content;
      log.debug({ projectId }, "repo scan wrote memory");
      return "Memory updated.";
    },

    async updateMemory(oldStr, newStr) {
      if (!state.memory.includes(oldStr)) {
        return "Error: old_string not found in memory.";
      }
      const updated = state.memory.replace(oldStr, newStr);
      await db
        .update(project)
        .set({ agentMemory: updated })
        .where(eq(project.id, projectId));
      state.memory = updated;
      log.debug({ projectId }, "repo scan updated memory section");
      return "Memory updated.";
    },
  };
}
