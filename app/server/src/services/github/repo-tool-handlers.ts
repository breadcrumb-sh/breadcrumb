import picomatch from "picomatch";
import type { Octokit } from "@octokit/core";
import { getGitHubApp } from "../../shared/lib/github-app-instance.js";
import { getInstallationForProject } from "./installations.js";
import type { RepoToolHandlers } from "./repo-tools.js";

/**
 * Concrete `RepoToolHandlers` implementation backed by GitHub.
 *
 * Construct one per agent run via `createRepoToolHandlers(projectId)`.
 * The instance:
 *   - Mints a single installation Octokit client up front
 *   - Validates every `repo` arg against the project's tracked-repos list
 *     (so the agent can never read repos outside its scope)
 *   - Memoizes results per call signature for the lifetime of the run, so
 *     the agent can re-list / re-read without paying twice
 */

const DEFAULT_READ_LIMIT = 200;
const MAX_READ_LIMIT = 2000;
const MAX_FILE_BYTES = 200_000;
const MAX_GLOB_RESULTS = 200;
const MAX_GREP_RESULTS = 30;

export async function createRepoToolHandlers(
  projectId: string,
): Promise<RepoToolHandlers> {
  const installation = await getInstallationForProject(projectId);
  if (!installation) {
    throw new Error("No GitHub installation linked to this project");
  }
  if (installation.suspendedAt) {
    throw new Error("GitHub installation is suspended; reconnect to use repo tools");
  }
  if (installation.trackedRepos.length === 0) {
    throw new Error("No repositories tracked for this project");
  }

  const app = getGitHubApp();
  if (!app) {
    throw new Error("GitHub App is not configured on this instance");
  }

  const octokit = (await app.getInstallationOctokit(
    installation.installationId,
  )) as Octokit;

  const cache = new Map<string, string>();

  function resolveRepo(fullName: string) {
    const repo = installation!.trackedRepos.find((r) => r.fullName === fullName);
    if (!repo) {
      const tracked = installation!.trackedRepos
        .map((r) => r.fullName)
        .join(", ");
      throw new Error(
        `Repo '${fullName}' is not tracked by this project. Tracked repos: ${tracked || "none"}`,
      );
    }
    return repo;
  }

  async function memo(key: string, fn: () => Promise<string>): Promise<string> {
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const result = await fn();
    cache.set(key, result);
    return result;
  }

  return {
    async listFiles(repo, path) {
      try {
        const r = resolveRepo(repo);
        const cleanPath = trimSlashes(path);
        return await memo(`list:${repo}:${cleanPath}`, async () => {
          const { data } = await octokit.request(
            "GET /repos/{owner}/{repo}/contents/{path}",
            {
              owner: r.ownerLogin,
              repo: r.name,
              path: cleanPath,
            },
          );
          if (!Array.isArray(data)) {
            return `${cleanPath || "/"} is a file, not a directory. Use read_file instead.`;
          }
          if (data.length === 0) {
            return `${repo}:${cleanPath || "/"} is empty`;
          }
          const dirs = data
            .filter((e) => e.type === "dir")
            .map((e) => `${e.name}/`)
            .sort();
          const files = data
            .filter((e) => e.type === "file")
            .map((e) => `${e.name} (${formatBytes(e.size)})`)
            .sort();
          const lines = [`${repo}:${cleanPath || "/"}`, ...dirs, ...files];
          return lines.join("\n");
        });
      } catch (err) {
        return formatError(err, "list_files");
      }
    },

    async globFiles(repo, pattern) {
      try {
        const r = resolveRepo(repo);
        return await memo(`glob:${repo}:${pattern}`, async () => {
          const branch = r.defaultBranch ?? "main";
          const { data } = await octokit.request(
            "GET /repos/{owner}/{repo}/git/trees/{tree_sha}",
            {
              owner: r.ownerLogin,
              repo: r.name,
              tree_sha: branch,
              recursive: "1",
            },
          );

          const matcher = picomatch(pattern);
          const matches: string[] = [];
          for (const entry of data.tree) {
            if (entry.type === "blob" && entry.path && matcher(entry.path)) {
              matches.push(entry.path);
              if (matches.length >= MAX_GLOB_RESULTS) break;
            }
          }

          if (matches.length === 0) {
            return `No files in ${repo} match '${pattern}'`;
          }

          const truncated = data.truncated
            ? "\n(Note: GitHub truncated the repo tree — results may be incomplete for very large repos)"
            : "";
          const capped =
            matches.length === MAX_GLOB_RESULTS
              ? `\n(Showing first ${MAX_GLOB_RESULTS} matches — narrow your pattern for more)`
              : "";
          return `Found ${matches.length} matches in ${repo} for '${pattern}':\n${matches.join("\n")}${truncated}${capped}`;
        });
      } catch (err) {
        return formatError(err, "glob_files");
      }
    },

    async grepRepo(repo, query) {
      try {
        const r = resolveRepo(repo);
        return await memo(`grep:${repo}:${query}`, async () => {
          const { data } = await octokit.request("GET /search/code", {
            q: `${query} repo:${r.fullName}`,
            per_page: MAX_GREP_RESULTS,
            headers: {
              accept: "application/vnd.github.text-match+json",
            },
          });

          if (data.items.length === 0) {
            return `No matches for '${query}' in ${repo}`;
          }

          const lines: string[] = [
            `Found ${data.total_count} matches in ${repo} (showing ${data.items.length}):`,
          ];
          for (const item of data.items as Array<{
            path: string;
            text_matches?: Array<{ fragment: string }>;
          }>) {
            lines.push("");
            lines.push(`${item.path}:`);
            const fragments = item.text_matches?.slice(0, 2) ?? [];
            if (fragments.length === 0) {
              lines.push("  (no fragment available)");
            } else {
              for (const frag of fragments) {
                const indented = frag.fragment
                  .trim()
                  .split("\n")
                  .map((l) => `  ${l}`)
                  .join("\n");
                lines.push(indented);
              }
            }
          }
          return lines.join("\n");
        });
      } catch (err) {
        return formatError(err, "grep_repo");
      }
    },

    async readFile(repo, path, { offset, limit, ref }) {
      try {
        const r = resolveRepo(repo);
        const cleanPath = trimSlashes(path);
        const startLine = offset ?? 1;
        const maxLines = Math.min(limit ?? DEFAULT_READ_LIMIT, MAX_READ_LIMIT);
        const cacheKey = `read:${repo}:${cleanPath}:${ref ?? ""}:${startLine}:${maxLines}`;

        return await memo(cacheKey, async () => {
          const { data } = await octokit.request(
            "GET /repos/{owner}/{repo}/contents/{path}",
            {
              owner: r.ownerLogin,
              repo: r.name,
              path: cleanPath,
              ref: ref ?? r.defaultBranch ?? undefined,
            },
          );

          if (Array.isArray(data) || data.type !== "file") {
            return `${cleanPath} is not a file`;
          }

          if (data.size > MAX_FILE_BYTES) {
            return `File ${cleanPath} is ${formatBytes(data.size)} (over the ${formatBytes(MAX_FILE_BYTES)} cap). Use grep_repo to search inside it, or pass an offset+limit to read specific lines.`;
          }

          const content = Buffer.from(data.content ?? "", "base64").toString(
            "utf8",
          );

          if (content.includes("\x00")) {
            return `File ${cleanPath} appears to be binary; skipping`;
          }

          const allLines = content.split("\n");
          const totalLines = allLines.length;
          const fromIdx = Math.max(0, startLine - 1);
          if (fromIdx >= totalLines) {
            return `${cleanPath} only has ${totalLines} lines; offset ${startLine} is past the end`;
          }
          const toIdx = Math.min(allLines.length, fromIdx + maxLines);
          const slice = allLines.slice(fromIdx, toIdx);

          const padWidth = String(toIdx).length;
          const numbered = slice
            .map(
              (line, i) =>
                `${String(fromIdx + i + 1).padStart(padWidth)}→${line}`,
            )
            .join("\n");

          const header = `${repo}:${cleanPath} (lines ${fromIdx + 1}-${toIdx} of ${totalLines}, ${formatBytes(data.size)})`;
          return `${header}\n${numbered}`;
        });
      } catch (err) {
        return formatError(err, "read_file");
      }
    },
  };
}

// ── Helpers ─────────────────────────────────────────────────────────

function trimSlashes(s: string): string {
  return s.replace(/^\/+|\/+$/g, "");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatError(err: unknown, toolName: string): string {
  const status = (err as { status?: number } | null)?.status;
  const message = (err as { message?: string } | null)?.message ?? String(err);
  if (status === 404) return `${toolName} failed: not found`;
  if (status === 403) return `${toolName} failed: access denied (${message})`;
  if (status === 422) return `${toolName} failed: invalid request (${message})`;
  if (status === 401)
    return `${toolName} failed: GitHub installation token rejected — installation may have been removed`;
  return `${toolName} failed: ${message}`;
}
