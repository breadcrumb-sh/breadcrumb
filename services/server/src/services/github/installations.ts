import { and, eq } from "drizzle-orm";
import { db } from "../../shared/db/postgres.js";
import {
  githubInstallations,
  githubTrackedRepos,
} from "../../shared/db/schema.js";
import { getGitHubApp } from "../../shared/lib/github-app-instance.js";
import { logger } from "../../shared/lib/logger.js";

/**
 * Domain logic for the GitHub App integration.
 *
 * The HTTP/tRPC layer is intentionally thin — all DB access and Octokit
 * calls live here so they can be reused across the install callback,
 * tRPC procedures, and (later) agent code paths.
 */

const MAX_TRACKED_REPOS_PER_PROJECT = 3;
const MAX_REPOS_FETCHED = 1000; // hard cap to prevent runaway pagination on huge orgs

// ─── Types ──────────────────────────────────────────────────────────

export type InstallationDetails = {
  installationId: number;
  accountLogin: string;
  accountType: "User" | "Organization";
  accountId: number;
  accountAvatarUrl: string | null;
  repositorySelection: "all" | "selected";
};

export type AvailableRepo = {
  repoId: number;
  ownerLogin: string;
  name: string;
  fullName: string;
  defaultBranch: string | null;
  isPrivate: boolean;
  htmlUrl: string;
};

export type TrackedRepo = AvailableRepo & {
  id: string;
  addedAt: Date;
};

export type InstallationForProject = {
  id: string;
  installationId: number;
  accountLogin: string;
  accountType: string;
  accountAvatarUrl: string | null;
  repositorySelection: string;
  suspendedAt: Date | null;
  createdAt: Date;
  trackedRepos: TrackedRepo[];
};

// ─── GitHub API helpers ─────────────────────────────────────────────

function requireApp() {
  const app = getGitHubApp();
  if (!app) {
    throw new Error("GitHub App is not configured on this instance");
  }
  return app;
}

/** Hits GET /app/installations/{id} using the app JWT. */
export async function fetchInstallationDetails(
  installationId: number,
): Promise<InstallationDetails> {
  const app = requireApp();
  const { data } = await app.octokit.request(
    "GET /app/installations/{installation_id}",
    { installation_id: installationId },
  );
  if (!data.account || !("login" in data.account)) {
    throw new Error("Installation has no account");
  }
  return {
    installationId: data.id,
    accountLogin: data.account.login,
    accountType: data.account.type === "Organization" ? "Organization" : "User",
    accountId: data.account.id,
    accountAvatarUrl: data.account.avatar_url ?? null,
    repositorySelection: data.repository_selection,
  };
}

/**
 * Lists all repositories the installation has access to. Uses
 * `app.eachRepository` for built-in pagination. Hard-capped at
 * MAX_REPOS_FETCHED to keep memory bounded on huge orgs.
 */
export async function fetchAvailableRepos(
  installationId: number,
): Promise<AvailableRepo[]> {
  const app = requireApp();
  const repos: AvailableRepo[] = [];
  for await (const { repository } of app.eachRepository.iterator({
    installationId,
  })) {
    repos.push({
      repoId: repository.id,
      ownerLogin: repository.owner.login,
      name: repository.name,
      fullName: repository.full_name,
      defaultBranch: repository.default_branch ?? null,
      isPrivate: repository.private,
      htmlUrl: repository.html_url,
    });
    if (repos.length >= MAX_REPOS_FETCHED) {
      logger.warn(
        { installationId, cap: MAX_REPOS_FETCHED },
        "github: hit repo fetch cap",
      );
      break;
    }
  }
  return repos;
}

/**
 * Builds the GitHub install URL with our state token attached. Returns the
 * URL the browser should be sent to. Works for both github.com and GHE.
 */
export async function buildInstallUrl(state: string): Promise<string> {
  const app = requireApp();
  return await app.getInstallationUrl({ state });
}

// ─── DB operations ──────────────────────────────────────────────────

/**
 * Creates or updates the installation row for a project. Project_id is
 * unique, so this is an upsert keyed on project_id. Tracked repos are
 * preserved across re-installs (the user might re-grant the same
 * installation; we don't want to wipe their picks).
 */
export async function upsertInstallation(opts: {
  projectId: string;
  createdById: string;
  details: InstallationDetails;
}): Promise<{ id: string; isNew: boolean }> {
  const { projectId, createdById, details } = opts;
  const existing = await db
    .select({ id: githubInstallations.id })
    .from(githubInstallations)
    .where(eq(githubInstallations.projectId, projectId))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(githubInstallations)
      .set({
        installationId: details.installationId,
        accountLogin: details.accountLogin,
        accountType: details.accountType,
        accountId: details.accountId,
        accountAvatarUrl: details.accountAvatarUrl,
        repositorySelection: details.repositorySelection,
        suspendedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(githubInstallations.id, existing[0].id));
    return { id: existing[0].id, isNew: false };
  }

  const [row] = await db
    .insert(githubInstallations)
    .values({
      projectId,
      installationId: details.installationId,
      accountLogin: details.accountLogin,
      accountType: details.accountType,
      accountId: details.accountId,
      accountAvatarUrl: details.accountAvatarUrl,
      repositorySelection: details.repositorySelection,
      createdById,
    })
    .returning({ id: githubInstallations.id });
  return { id: row.id, isNew: true };
}

export async function getInstallationForProject(
  projectId: string,
): Promise<InstallationForProject | null> {
  const [installation] = await db
    .select()
    .from(githubInstallations)
    .where(eq(githubInstallations.projectId, projectId))
    .limit(1);

  if (!installation) return null;

  const tracked = await db
    .select()
    .from(githubTrackedRepos)
    .where(eq(githubTrackedRepos.installationRowId, installation.id));

  return {
    id: installation.id,
    installationId: installation.installationId,
    accountLogin: installation.accountLogin,
    accountType: installation.accountType,
    accountAvatarUrl: installation.accountAvatarUrl,
    repositorySelection: installation.repositorySelection,
    suspendedAt: installation.suspendedAt,
    createdAt: installation.createdAt,
    trackedRepos: tracked.map((r) => ({
      id: r.id,
      repoId: r.repoId,
      ownerLogin: r.ownerLogin,
      name: r.name,
      fullName: r.fullName,
      defaultBranch: r.defaultBranch,
      isPrivate: r.isPrivate,
      htmlUrl: r.htmlUrl,
      addedAt: r.addedAt,
    })),
  };
}

/**
 * Replaces the project's tracked repo selection. Validates against a fresh
 * fetch from GitHub so the client can't smuggle repos that aren't actually
 * granted to the installation. Enforces the per-project cap.
 */
export async function setTrackedRepos(opts: {
  projectId: string;
  repoIds: number[];
}): Promise<TrackedRepo[]> {
  const { projectId, repoIds } = opts;

  if (repoIds.length > MAX_TRACKED_REPOS_PER_PROJECT) {
    throw new Error(
      `Too many repos selected (max ${MAX_TRACKED_REPOS_PER_PROJECT})`,
    );
  }

  // Reject duplicates in input.
  const uniqueIds = [...new Set(repoIds)];
  if (uniqueIds.length !== repoIds.length) {
    throw new Error("Duplicate repo IDs in selection");
  }

  const installation = await getInstallationForProject(projectId);
  if (!installation) {
    throw new Error("No GitHub installation linked to this project");
  }

  // Re-fetch from GitHub so we (a) have fresh metadata and (b) reject
  // any repo IDs that aren't actually granted to this installation.
  const available = await fetchAvailableRepos(installation.installationId);
  const availableById = new Map(available.map((r) => [r.repoId, r]));

  const picked: AvailableRepo[] = [];
  for (const id of uniqueIds) {
    const repo = availableById.get(id);
    if (!repo) {
      throw new Error(
        `Repo ${id} is not available in this installation. Refresh and try again.`,
      );
    }
    picked.push(repo);
  }

  // Replace strategy: clear existing tracked rows and insert the new set.
  await db.transaction(async (tx) => {
    await tx
      .delete(githubTrackedRepos)
      .where(eq(githubTrackedRepos.installationRowId, installation.id));
    if (picked.length > 0) {
      await tx.insert(githubTrackedRepos).values(
        picked.map((r) => ({
          installationRowId: installation.id,
          repoId: r.repoId,
          ownerLogin: r.ownerLogin,
          name: r.name,
          fullName: r.fullName,
          defaultBranch: r.defaultBranch,
          isPrivate: r.isPrivate,
          htmlUrl: r.htmlUrl,
        })),
      );
    }
  });

  // Return the fresh state.
  const updated = await getInstallationForProject(projectId);
  return updated?.trackedRepos ?? [];
}

export async function deleteInstallationLink(
  projectId: string,
): Promise<void> {
  await db
    .delete(githubInstallations)
    .where(eq(githubInstallations.projectId, projectId));
}

export async function markInstallationSuspended(
  installationRowId: string,
): Promise<void> {
  await db
    .update(githubInstallations)
    .set({ suspendedAt: new Date(), updatedAt: new Date() })
    .where(eq(githubInstallations.id, installationRowId));
}

/**
 * Live fetch wrapper for the picker UI: returns the available repos and
 * the current tracked selection in one call. Throws if no installation.
 */
export async function listAvailableReposForProject(projectId: string): Promise<{
  available: AvailableRepo[];
  trackedRepoIds: number[];
}> {
  const installation = await getInstallationForProject(projectId);
  if (!installation) {
    throw new Error("No GitHub installation linked to this project");
  }
  try {
    const available = await fetchAvailableRepos(installation.installationId);
    return {
      available,
      trackedRepoIds: installation.trackedRepos.map((r) => r.repoId),
    };
  } catch (err) {
    // If GitHub returns 404/401, the installation was likely removed on
    // GitHub's side. Mark suspended so the UI can react.
    if (isInstallationGone(err)) {
      await markInstallationSuspended(installation.id);
    }
    throw err;
  }
}

function isInstallationGone(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const status = (err as { status?: number }).status;
  return status === 404 || status === 401;
}
