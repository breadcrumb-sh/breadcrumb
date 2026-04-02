// ── Error class ────────────────────────────────────────────────────

export class QueryValidationError extends Error {
  code: string;
  details: string[];

  constructor(code: string, message: string, details: string[] = []) {
    super(message);
    this.name = "QueryValidationError";
    this.code = code;
    this.details = details;
  }
}

// ── Limits ──────────────────────────────────────────────────────────

/** Maximum allowed query length in characters (10 KB) */
const MAX_QUERY_LENGTH = 10_000;

// ── Blocklists ─────────────────────────────────────────────────────
// Table functions that could read external resources or escape the sandbox.

const BLOCKED_FUNCTIONS = new Set([
  "url",
  "remote",
  "remotesecure",
  "file",
  "s3",
  "s3cluster",
  "input",
  "cluster",
  "clusterallreplicas",
  "mysql",
  "postgresql",
  "mongodb",
  "redis",
  "hdfs",
  "jdbc",
]);

// ── Validation ─────────────────────────────────────────────────────

const SELECT_PATTERN = /^\s*(WITH|SELECT)\b/i;
const SETTINGS_PATTERN = /\bSETTINGS\b/i;

/**
 * Build a case-insensitive regex that matches a blocked function name
 * followed by an opening parenthesis (with optional whitespace).
 */
function buildBlockedFunctionPattern(): RegExp {
  const names = [...BLOCKED_FUNCTIONS].join("|");
  return new RegExp(`\\b(${names})\\s*\\(`, "i");
}

const BLOCKED_FUNCTION_PATTERN = buildBlockedFunctionPattern();

/**
 * Validate a SQL query for safe sandboxed execution.
 *
 * Project isolation is enforced by ClickHouse row policies on the
 * breadcrumb_sandbox user — no SQL rewriting is needed. This function
 * performs lightweight checks to reject obviously dangerous queries
 * before they reach ClickHouse.
 *
 * Checks:
 *   1. Query length limit
 *   2. Must be a SELECT statement (or WITH … SELECT)
 *   3. Must not contain a SETTINGS clause
 *   4. Must not call blocked table functions (url, remote, file, etc.)
 *
 * Throws QueryValidationError if the query is invalid.
 */
export function validateQuery(sql: string): void {
  if (!sql.trim()) {
    throw new QueryValidationError(
      "PARSE_ERROR",
      "Empty query",
      ["Query string is empty"],
    );
  }

  if (sql.length > MAX_QUERY_LENGTH) {
    throw new QueryValidationError(
      "QUERY_TOO_LONG",
      `Query exceeds maximum length of ${MAX_QUERY_LENGTH} characters`,
      [`Query is ${sql.length} characters (max ${MAX_QUERY_LENGTH})`],
    );
  }

  if (!SELECT_PATTERN.test(sql)) {
    throw new QueryValidationError(
      "NON_SELECT",
      "Only SELECT statements are allowed",
      ["Query must start with SELECT or WITH"],
    );
  }

  if (SETTINGS_PATTERN.test(sql)) {
    throw new QueryValidationError(
      "SETTINGS_NOT_ALLOWED",
      "SETTINGS clauses are not allowed",
      ["Remove the SETTINGS clause from your query"],
    );
  }

  const blockedMatch = sql.match(BLOCKED_FUNCTION_PATTERN);
  if (blockedMatch) {
    const funcName = blockedMatch[1].toLowerCase();
    throw new QueryValidationError(
      "BLOCKED_FUNCTION",
      `Function "${funcName}" is not allowed`,
      [`Table function "${funcName}" is blocked for security reasons`],
    );
  }
}
