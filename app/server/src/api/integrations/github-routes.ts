import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { db } from "../../shared/db/postgres.js";
import { member, project } from "../../shared/db/schema.js";
import { auth } from "../../shared/auth/better-auth.js";
import { env } from "../../env.js";
import { getGitHubAppConfig } from "../../shared/lib/github-app.js";
import { verifyStateToken } from "../../shared/lib/state-token.js";
import {
  fetchInstallationDetails,
  upsertInstallation,
} from "../../services/github/installations.js";
import { logger } from "../../shared/lib/logger.js";

/**
 * Hono routes for the GitHub App install flow.
 *
 * The callback endpoint is the only thing GitHub talks to directly. The
 * tRPC layer (`github.createInstallUrl`) generates the URL the user is
 * redirected to; GitHub then redirects them back here once they've
 * picked an account and granted repos.
 *
 * All routes return 302 redirects with `?connected`, `?error`, or
 * `?info` query params on the project settings page so the UI can
 * surface a toast.
 */

export const githubIntegrationRoutes = new Hono();

const ADMIN_ROLES = ["admin", "owner"];

function settingsUrl(projectId: string, params: Record<string, string>): string {
  const search = new URLSearchParams({ tab: "integrations", ...params });
  return `${env.appBaseUrl}/projects/${projectId}/settings?${search.toString()}`;
}

function loginRedirect(nextPath: string): string {
  const search = new URLSearchParams({ next: nextPath });
  return `${env.appBaseUrl}/login?${search.toString()}`;
}

githubIntegrationRoutes.get("/callback", async (c) => {
  const config = getGitHubAppConfig();
  if (!config) {
    return c.text("GitHub integration is not configured on this instance.", 503);
  }

  const url = new URL(c.req.url);
  const stateRaw = url.searchParams.get("state");
  const installationIdRaw = url.searchParams.get("installation_id");
  const setupAction = url.searchParams.get("setup_action") ?? "install";

  // ── 1. Verify state token ────────────────────────────────────────
  if (!stateRaw) {
    logger.warn("github callback: missing state");
    return c.redirect(`${env.appBaseUrl}/?error=invalid_state`, 302);
  }
  const state = await verifyStateToken(stateRaw);
  if (!state) {
    logger.warn("github callback: invalid state token");
    return c.redirect(`${env.appBaseUrl}/?error=invalid_state`, 302);
  }

  const nextPath = `/projects/${state.projectId}/settings?tab=integrations`;

  // ── 2. Verify session ────────────────────────────────────────────
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session?.user || session.user.id !== state.userId) {
    return c.redirect(loginRedirect(nextPath), 302);
  }

  // ── 3. Verify project still exists and user is project admin ────
  const [proj] = await db
    .select({ organizationId: project.organizationId })
    .from(project)
    .where(eq(project.id, state.projectId));
  if (!proj) {
    return c.redirect(`${env.appBaseUrl}/?error=project_not_found`, 302);
  }

  const [m] = await db
    .select({ role: member.role })
    .from(member)
    .where(
      and(
        eq(member.organizationId, proj.organizationId),
        eq(member.userId, state.userId),
      ),
    );
  if (!m || !ADMIN_ROLES.includes(m.role)) {
    return c.redirect(settingsUrl(state.projectId, { error: "forbidden" }), 302);
  }

  // ── 4. Handle "request access" path (no installation_id) ─────────
  // Happens when the user lacks org admin permission and asked an
  // owner to approve. No row to write yet — surface a friendly message.
  if (setupAction === "request" || !installationIdRaw) {
    return c.redirect(
      settingsUrl(state.projectId, { info: "install_pending" }),
      302,
    );
  }

  const installationId = Number(installationIdRaw);
  if (!Number.isFinite(installationId)) {
    return c.redirect(
      settingsUrl(state.projectId, { error: "invalid_installation" }),
      302,
    );
  }

  // ── 5. Fetch installation details and write the row ─────────────
  try {
    const details = await fetchInstallationDetails(installationId);
    const { id: installationRowId } = await upsertInstallation({
      projectId: state.projectId,
      createdById: state.userId,
      details,
    });
    return c.redirect(
      settingsUrl(state.projectId, { connected: installationRowId }),
      302,
    );
  } catch (err) {
    logger.error(
      { err, installationId, projectId: state.projectId },
      "github callback: failed to write installation",
    );
    const status = (err as { status?: number }).status;
    const errorCode =
      status === 404 ? "not_found" : status === 401 ? "unauthorized" : "github_unavailable";
    return c.redirect(
      settingsUrl(state.projectId, { error: errorCode }),
      302,
    );
  }
});
