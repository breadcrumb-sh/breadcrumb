import { App } from "@octokit/app";
import { Octokit } from "@octokit/core";
import { getGitHubAppConfig } from "./github-app.js";

/**
 * Singleton wrapper around `@octokit/app`'s `App`.
 *
 * The `App` instance internally caches installation tokens until ~1 minute
 * before expiry, so we want one instance per process — not one per request.
 *
 * Returns `null` if the GitHub integration is not configured. Callers must
 * handle that case (typically the surrounding code already gates on
 * `getGitHubAppConfig()` and only reaches this once it's confirmed enabled).
 *
 * GHE Server is supported by passing a custom `Octokit` whose `baseUrl` is
 * derived from `GITHUB_API_URL`. The default is `https://api.github.com`.
 */

let cached: App | null | undefined;

export function getGitHubApp(): App | null {
  if (cached !== undefined) return cached;

  const cfg = getGitHubAppConfig();
  if (!cfg) {
    cached = null;
    return cached;
  }

  const CustomOctokit = Octokit.defaults({
    baseUrl: cfg.apiUrl,
    userAgent: "breadcrumb",
  });

  cached = new App({
    appId: cfg.appId,
    privateKey: cfg.privateKey,
    oauth: {
      clientId: cfg.clientId,
      clientSecret: cfg.clientSecret,
    },
    ...(cfg.webhookSecret ? { webhooks: { secret: cfg.webhookSecret } } : {}),
    Octokit: CustomOctokit,
  });

  return cached;
}

/** For tests: clear the cached App so a new env mock takes effect. */
export function __resetGitHubAppForTests() {
  cached = undefined;
}
