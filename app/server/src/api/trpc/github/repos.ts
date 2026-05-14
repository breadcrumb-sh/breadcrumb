import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  router,
  projectMemberProcedure,
  projectAdminProcedure,
} from "../../../trpc.js";
import { getGitHubAppConfig } from "../../../shared/lib/github-app.js";
import {
  getInstallationForProject,
  listAvailableReposForProject,
  setTrackedRepos,
} from "../../../services/github/installations.js";

function requireConfig() {
  const config = getGitHubAppConfig();
  if (!config) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "GitHub integration is not configured on this instance. Set GITHUB_APP_* environment variables — see docs.",
    });
  }
  return config;
}

export const githubReposRouter = router({
  /**
   * Returns the project's installation row + tracked repos. Returns
   * `null` if no installation has been linked yet (the UI then renders
   * the empty state with the "Connect repository" button).
   */
  getInstallation: projectMemberProcedure.query(async ({ ctx }) => {
    requireConfig();
    return await getInstallationForProject(ctx.projectId);
  }),

  /**
   * Live picker payload — fetches the available repos directly from
   * GitHub (not cached) so the modal always shows the latest. Returns
   * the currently-tracked repo IDs alongside so the picker can
   * pre-check the right boxes.
   */
  listAvailableRepos: projectMemberProcedure.query(async ({ ctx }) => {
    requireConfig();
    try {
      return await listAvailableReposForProject(ctx.projectId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to list repos";
      throw new TRPCError({ code: "BAD_REQUEST", message });
    }
  }),

  /**
   * Replaces the project's tracked repo selection. Validates against a
   * fresh fetch from GitHub and enforces the per-project cap.
   */
  setTrackedRepos: projectAdminProcedure
    .input(
      z.object({
        projectId: z.string(),
        repoIds: z.array(z.number().int().positive()).max(3),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requireConfig();
      try {
        return await setTrackedRepos({
          projectId: ctx.projectId,
          repoIds: input.repoIds,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to save selection";
        throw new TRPCError({ code: "BAD_REQUEST", message });
      }
    }),
});
