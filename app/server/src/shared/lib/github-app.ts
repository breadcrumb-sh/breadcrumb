import { env } from "../../env.js";

/**
 * Runtime configuration for the GitHub App integration.
 *
 * The GitHub App is an *optional* self-host feature. Its credentials live in
 * env vars only — there is no admin UI for managing them. If the minimum set
 * of vars is unset, `getGitHubAppConfig()` returns `null` and the integration
 * is disabled at the tRPC and UI layers.
 *
 * This is the single source of truth for "is the GitHub integration
 * configured on this instance?" — callers should never read `process.env`
 * directly.
 */
export type GitHubAppConfig = {
  appId: string;
  slug: string;
  privateKey: string;
  clientId: string;
  clientSecret: string;
  webhookSecret: string | null;
  apiUrl: string;
};

let cached: GitHubAppConfig | null | undefined;

export function getGitHubAppConfig(): GitHubAppConfig | null {
  if (cached !== undefined) return cached;

  const {
    githubAppId,
    githubAppSlug,
    githubAppPrivateKey,
    githubAppClientId,
    githubAppClientSecret,
    githubAppWebhookSecret,
    githubApiUrl,
  } = env;

  // Minimum set required to mint installation tokens and run the install flow.
  if (
    !githubAppId ||
    !githubAppSlug ||
    !githubAppPrivateKey ||
    !githubAppClientId ||
    !githubAppClientSecret
  ) {
    cached = null;
    return cached;
  }

  cached = {
    appId: githubAppId,
    slug: githubAppSlug,
    // Accept both raw PEM and `\n`-escaped single-line PEM (common in .env files).
    privateKey: githubAppPrivateKey.replace(/\\n/g, "\n"),
    clientId: githubAppClientId,
    clientSecret: githubAppClientSecret,
    webhookSecret: githubAppWebhookSecret ?? null,
    apiUrl: githubApiUrl,
  };
  return cached;
}

export function isGitHubAppEnabled(): boolean {
  return getGitHubAppConfig() !== null;
}

/**
 * For tests: reset the cached config so a subsequent call re-reads env.
 */
export function __resetGitHubAppConfigForTests() {
  cached = undefined;
}
