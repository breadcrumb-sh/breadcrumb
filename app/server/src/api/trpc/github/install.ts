import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, projectAdminProcedure } from "../../../trpc.js";
import { getGitHubAppConfig } from "../../../shared/lib/github-app.js";
import { signStateToken } from "../../../shared/lib/state-token.js";
import { buildInstallUrl, deleteInstallationLink } from "../../../services/github/installations.js";
import { runRepoScan } from "../../../services/github/scan.js";

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

export const githubInstallRouter = router({
  /**
   * Returns the GitHub install URL with our state token attached.
   * Frontend does `window.location.href = url` to start the flow.
   *
   * Project admin only — server enforces here so the frontend can
   * unconditionally render the button.
   */
  createInstallUrl: projectAdminProcedure.mutation(async ({ ctx }) => {
    requireConfig();
    const state = await signStateToken({
      projectId: ctx.projectId,
      userId: ctx.user.id,
    });
    const url = await buildInstallUrl(state);
    return { url };
  }),

  /**
   * Removes the link between this project and its GitHub installation.
   * Cascades to delete all tracked repo selections. Does NOT uninstall
   * the app on github.com — that has to happen on GitHub's side and
   * may affect other projects sharing the same installation.
   */
  disconnect: projectAdminProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(async ({ ctx }) => {
      requireConfig();
      await deleteInstallationLink(ctx.projectId);
      return { ok: true as const };
    }),

  /**
   * Manually kick off a repo scan agent run. Synchronous — blocks until
   * the scan completes (typically 1-2 minutes). No triggers wire this up
   * yet; it's invoked by hand for testing.
   */
  runScan: projectAdminProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(async ({ ctx }) => {
      requireConfig();
      return await runRepoScan(ctx.projectId);
    }),
});
