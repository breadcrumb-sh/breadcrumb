import { tool } from "ai";
import { z } from "zod";

/**
 * Pure tool definitions for browsing connected GitHub repositories.
 *
 * Mirrors the existing scan-agent / investigate-agent pattern: this file
 * contains zero I/O. The runner wires up a `RepoToolHandlers`
 * implementation (see repo-tool-handlers.ts) at construction time, which
 * makes the tool surface trivial to swap out for unit tests and evals.
 *
 * The toolset is intentionally shaped like a mini filesystem (list_files,
 * glob_files, grep_repo, read_file) so a code-savvy agent can explore
 * the repo the same way it would explore a local checkout, instead of
 * being handed a frozen blob of pre-fetched files.
 */

export interface RepoToolHandlers {
  /** Lists files and directories at a path. Empty path = repo root. */
  listFiles(repo: string, path: string): Promise<string>;

  /** Finds files matching a glob pattern across the entire repo. */
  globFiles(repo: string, pattern: string): Promise<string>;

  /** Searches file contents for a literal text query. Default branch only. */
  grepRepo(repo: string, query: string): Promise<string>;

  /** Reads a slice of a file. Returns numbered lines like ripgrep. */
  readFile(
    repo: string,
    path: string,
    options: { offset?: number; limit?: number; ref?: string },
  ): Promise<string>;
}

export function createRepoTools(handlers: RepoToolHandlers) {
  return {
    list_files: tool({
      description:
        "List files and directories at a path inside a tracked repository. Use this to explore the codebase structure. Directories are suffixed with '/'.",
      inputSchema: z.object({
        repo: z
          .string()
          .describe(
            "The repository in 'owner/name' format. Must be one of the project's tracked repos.",
          ),
        path: z
          .string()
          .default("")
          .describe(
            "Directory path within the repo. Use empty string for the repo root.",
          ),
      }),
      execute: async ({ repo, path }) => handlers.listFiles(repo, path),
    }),

    glob_files: tool({
      description:
        "Find files matching a glob pattern across the entire repo (e.g. '**/*.ts', 'src/**/agent*.ts'). Use this when you know roughly what you're looking for but not the exact path. Returns at most 200 matches.",
      inputSchema: z.object({
        repo: z.string().describe("The repository in 'owner/name' format."),
        pattern: z
          .string()
          .describe(
            "Glob pattern. Examples: '**/*.ts' for all TypeScript files, 'src/agents/**' for everything under src/agents, '**/{prompt,system}*.{ts,md}'.",
          ),
      }),
      execute: async ({ repo, pattern }) => handlers.globFiles(repo, pattern),
    }),

    grep_repo: tool({
      description:
        "Search file contents for a literal text query. Uses GitHub's code search, which is keyword-based (NOT regex), default-branch only, and indexes files under ~384 KB. Best for finding identifiers, imports, or short literal phrases.",
      inputSchema: z.object({
        repo: z.string().describe("The repository in 'owner/name' format."),
        query: z
          .string()
          .describe(
            "Literal text to search for. Avoid regex syntax — GitHub's code search doesn't support it.",
          ),
      }),
      execute: async ({ repo, query }) => handlers.grepRepo(repo, query),
    }),

    read_file: tool({
      description:
        "Read all or part of a file from the repo. Returns numbered lines. For large files, use offset+limit to page through. Hard-capped at 200 KB per call.",
      inputSchema: z.object({
        repo: z.string().describe("The repository in 'owner/name' format."),
        path: z.string().describe("File path within the repo."),
        offset: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Line number to start from (1-indexed). Default: 1."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(2000)
          .optional()
          .describe("Maximum lines to return. Default: 200."),
        ref: z
          .string()
          .optional()
          .describe(
            "Branch, tag, or commit SHA. Default: the repo's default branch.",
          ),
      }),
      execute: async ({ repo, path, offset, limit, ref }) =>
        handlers.readFile(repo, path, { offset, limit, ref }),
    }),
  };
}
