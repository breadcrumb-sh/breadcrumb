import { router, authedProcedure } from "../../../trpc.js";
import { getGitHubAppConfig } from "../../../shared/lib/github-app.js";

/**
 * Public-to-authed-users config check. The disabled-state UI in
 * GitHubSection calls this once to decide whether to render the connect
 * button or the "not configured on this instance" card.
 */
export const githubConfigRouter = router({
  isEnabled: authedProcedure.query(() => {
    const config = getGitHubAppConfig();
    if (!config) return { enabled: false as const };
    return {
      enabled: true as const,
      slug: config.slug,
    };
  }),
});
