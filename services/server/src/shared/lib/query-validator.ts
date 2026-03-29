import {
  init as initPolyglot,
  isInitialized,
  parse,
  generate,
  Dialect,
} from "@polyglot-sql/sdk";

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

// ── Allowlists ─────────────────────────────────────────────────────
// Security model: everything NOT in these sets is rejected.

const ALLOWED_TABLES = new Set([
  "traces",
  "spans",
  "trace_rollups",
]);

const ALLOWED_FUNCTIONS = new Set([
  // Aggregates
  "count", "sum", "avg", "min", "max", "any", "argmax", "argmin",
  "uniq", "uniqexact", "uniqcombined", "uniqhll12",
  "quantile", "quantiles", "quantileexact",
  "grouparray", "groupuniqarray",
  "countif", "sumif", "avgif", "minif", "maxif",
  "sumwithoverflow",

  // Date/Time
  "todate", "todatetime", "todatetime64",
  "tostartofday", "tostartofhour", "tostartofminute",
  "tostartofweek", "tostartofmonth", "tostartofyear",
  "tostartoffiveminutes", "tostartoffifteenminutes",
  "formatdatetime", "parsedatetimebesteffort",
  "datediff", "dateadd", "datesub", "datename",
  "tointervalday", "tointervalhour", "tointervalminute",
  "tointervalweek", "tointervalmonth", "tointervalsecond",
  "toyear", "tomonth", "todayofweek", "todayofmonth",
  "tohour", "tominute", "tosecond",
  "now", "today", "yesterday",
  "tounixtimestamp", "tounixtimestamp64milli", "fromunixtimestamp",
  "totimezone",

  // String
  "lower", "upper", "length", "char_length",
  "trim", "ltrim", "rtrim",
  "substring", "substr", "left", "right",
  "concat", "concatwithseparator",
  "like", "ilike", "notlike", "notilike",
  "match", "extract", "replaceone", "replaceall", "replaceregexpone",
  "splitbychar", "splitbystring",
  "position", "positioncaseinsensitive",
  "tostring", "reverse",
  "startswith", "endswith",
  "base64encode", "base64decode",

  // Math
  "abs", "round", "ceil", "floor", "trunc",
  "sqrt", "cbrt", "log", "log2", "log10", "exp", "pow", "power",
  "intdiv", "intdivorzero", "modulo",
  "greatest", "least",
  "sign",

  // Type conversion
  "touint8", "touint16", "touint32", "touint64",
  "toint8", "toint16", "toint32", "toint64",
  "tofloat32", "tofloat64",
  "touuid", "cast",
  "todecimal32", "todecimal64", "todecimal128",
  "totypename",
  "reinterpretasuint64", "reinterpretasstring",
  "tostring",

  // Conditional / Null
  "if", "multiif", "coalesce",
  "isnull", "isnotnull", "ifnull", "nullif",
  "assumenotnull",

  // Array / Map
  "arraylength", "arrayelement", "arraymap", "arrayfilter",
  "arrayjoin", "arrayexists", "arrayconcat", "arrayreverse",
  "arrayflatten", "arraydistinct", "arrayreduce",
  "emptyarrayuint8", "emptyarraystring", "array",
  "has", "hasall", "hasany", "indexof",
  "mapkeys", "mapvalues",

  // Window functions
  "rownumber", "row_number", "rank", "denserank", "dense_rank",
  "lag", "lead", "first_value", "last_value", "nth_value",

  // Misc
  "tuple", "tupleelement",
  "generateuuidv4",
  "cityHash64", "sipHash64",
  "tovalidutf8",
]);

// ── Parser abstraction ─────────────────────────────────────────────
// All polyglot-sql calls go through these functions so the parser
// can be swapped with a single-file change.

async function ensureInit(): Promise<void> {
  if (!isInitialized()) {
    await initPolyglot();
  }
}

interface ParsedQuery {
  ast: unknown[];
  raw: unknown;
}

function parseSQL(sql: string): ParsedQuery {
  const result = parse(sql, Dialect.ClickHouse) as {
    success: boolean;
    ast: unknown[];
    error: string | null;
  };
  if (!result.success || !result.ast) {
    throw new QueryValidationError(
      "PARSE_ERROR",
      `Failed to parse SQL: ${result.error ?? "unknown error"}`,
      [result.error ?? "Parse failed"],
    );
  }
  return { ast: result.ast, raw: result };
}

function generateSQL(ast: unknown[]): string {
  const result = generate(ast, Dialect.ClickHouse) as {
    success: boolean;
    sql: string[];
    error: string | null;
  };
  if (!result.success || !result.sql?.length) {
    throw new QueryValidationError(
      "GENERATE_ERROR",
      `Failed to generate SQL: ${result.error ?? "unknown error"}`,
      [result.error ?? "Generate failed"],
    );
  }
  return result.sql[0];
}

// ── AST helpers ────────────────────────────────────────────────────

// Known AST keys that represent built-in aggregate/function nodes
// (polyglot-sql uses the function name as the key for well-known aggregates)
const BUILTIN_FUNCTION_KEYS = new Set([
  "count", "sum", "avg", "min", "max", "any",
  "lower", "upper", "length", "trim", "ltrim", "rtrim",
  "substring", "substr", "left", "right",
  "concat", "coalesce",
  "abs", "round", "ceil", "floor", "sqrt", "exp", "ln",
  "cast", "extract",
  "row_number", "rank", "dense_rank",
  "lag", "lead", "first_value", "last_value", "nth_value",
  "greatest", "least", "sign",
  "reverse", "replace",
  "power",
  "if_func",
]);

/**
 * Recursively walk the AST collecting all table names and function names.
 * Also detects SETTINGS clauses and non-SELECT statements.
 */
function collectAstInfo(ast: unknown[]): {
  tables: Array<{ name: string; schema: string | null; alias: string | null; path: string }>;
  functions: Array<{ name: string; path: string }>;
  cteNames: Set<string>;
  hasSettings: boolean;
} {
  const tables: Array<{ name: string; schema: string | null; alias: string | null; path: string }> = [];
  const functions: Array<{ name: string; path: string }> = [];
  const cteNames = new Set<string>();
  let hasSettings = false;

  function walkNode(node: unknown, path: string): void {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((item, i) => walkNode(item, `${path}[${i}]`));
      return;
    }

    const obj = node as Record<string, unknown>;

    // Detect table nodes
    if ("table" in obj && obj.table && typeof obj.table === "object") {
      const tableNode = obj.table as Record<string, unknown>;
      const nameObj = tableNode.name as { name: string } | null;
      const schemaObj = tableNode.schema as { name: string } | null;
      const aliasObj = tableNode.alias as { name: string } | null;
      if (nameObj?.name) {
        tables.push({
          name: nameObj.name,
          schema: schemaObj?.name ?? null,
          alias: aliasObj?.name ?? null,
          path,
        });
      }
    }

    // Detect generic function calls (key: "function" or "aggregate_function")
    if ("function" in obj && obj.function && typeof obj.function === "object") {
      const funcNode = obj.function as Record<string, unknown>;
      if (typeof funcNode.name === "string") {
        functions.push({ name: funcNode.name, path: `${path}.function` });
      }
    }
    if ("aggregate_function" in obj && obj.aggregate_function && typeof obj.aggregate_function === "object") {
      const funcNode = obj.aggregate_function as Record<string, unknown>;
      if (typeof funcNode.name === "string") {
        functions.push({ name: funcNode.name, path: `${path}.aggregate_function` });
      }
    }

    // Detect built-in function keys (count, sum, avg, etc.)
    for (const key of Object.keys(obj)) {
      if (BUILTIN_FUNCTION_KEYS.has(key) && obj[key] && typeof obj[key] === "object") {
        const builtinNode = obj[key] as Record<string, unknown>;
        // These nodes have original_name or similar identifiers
        const name = (builtinNode.original_name as string) || key;
        // if_func is really "if"
        const normalizedName = key === "if_func" ? "if" : name;
        functions.push({ name: normalizedName, path: `${path}.${key}` });
      }
    }

    // Detect SETTINGS clause
    if ("settings" in obj && obj.settings && Array.isArray(obj.settings) && (obj.settings as unknown[]).length > 0) {
      hasSettings = true;
    }

    // Detect CTE names
    if ("with" in obj && obj.with && typeof obj.with === "object") {
      const withClause = obj.with as Record<string, unknown>;
      if (Array.isArray(withClause.ctes)) {
        for (const cte of withClause.ctes) {
          const cteDef = cte as Record<string, unknown>;
          const alias = cteDef.alias as { name: string } | null;
          if (alias?.name) {
            cteNames.add(alias.name);
          }
        }
      }
    }

    // Recurse into all values
    for (const key of Object.keys(obj)) {
      if (key === "table") continue; // Already handled above
      walkNode(obj[key], `${path}.${key}`);
    }
  }

  walkNode(ast, "root");
  return { tables, functions, cteNames, hasSettings };
}

// ── Validation ─────────────────────────────────────────────────────

function validateStatements(ast: unknown[]): void {
  if (!ast.length) {
    throw new QueryValidationError(
      "PARSE_ERROR",
      "Empty query",
      ["No statements found"],
    );
  }

  if (ast.length > 1) {
    throw new QueryValidationError(
      "MULTIPLE_STATEMENTS",
      "Only single SELECT statements are allowed",
      ["Query contains multiple statements"],
    );
  }

  const stmt = ast[0] as Record<string, unknown>;
  const stmtType = Object.keys(stmt)[0];

  // Allow "select" and "union" (which contains select statements)
  if (stmtType !== "select" && stmtType !== "union") {
    throw new QueryValidationError(
      "NON_SELECT",
      `Only SELECT statements are allowed, got: ${stmtType.toUpperCase()}`,
      [`Statement type "${stmtType}" is not allowed`],
    );
  }
}

function validateAst(ast: unknown[]): {
  tables: Array<{ name: string; schema: string | null; alias: string | null; path: string }>;
  cteNames: Set<string>;
} {
  const { tables, functions, cteNames, hasSettings } = collectAstInfo(ast);
  const violations: string[] = [];

  // Reject SETTINGS
  if (hasSettings) {
    violations.push("SETTINGS clauses are not allowed");
  }

  // Validate tables
  for (const t of tables) {
    // Skip CTE references
    if (cteNames.has(t.name)) continue;

    // Normalize: strip database prefix, check against allowlist
    const tableName = t.name;
    const schema = t.schema;

    // If schema is provided, it must be "breadcrumb" (or null)
    if (schema && schema !== "breadcrumb") {
      violations.push(`Table "${schema}.${tableName}" is not allowed (only breadcrumb.* tables are accessible)`);
      continue;
    }

    if (!ALLOWED_TABLES.has(tableName)) {
      const qualified = schema ? `${schema}.${tableName}` : tableName;
      violations.push(`Table "${qualified}" is not allowed. Allowed tables: ${[...ALLOWED_TABLES].join(", ")}`);
    }
  }

  // Validate functions
  for (const f of functions) {
    if (!ALLOWED_FUNCTIONS.has(f.name.toLowerCase())) {
      violations.push(`Function "${f.name}" is not allowed`);
    }
  }

  if (violations.length > 0) {
    const code = violations.some((v) => v.includes("Table"))
      ? "DISALLOWED_TABLE"
      : violations.some((v) => v.includes("Function"))
        ? "DISALLOWED_FUNCTION"
        : "VALIDATION_ERROR";

    throw new QueryValidationError(
      code,
      `Query validation failed: ${violations[0]}`,
      violations,
    );
  }

  return { tables, cteNames };
}

// ── Project filter injection ───────────────────────────────────────

/**
 * Build a project_id = {projectId: UUID} condition AST node,
 * optionally qualified with a table alias.
 */
function buildProjectIdCondition(tableAlias: string | null): Record<string, unknown> {
  const column: Record<string, unknown> = {
    column: {
      name: { name: "project_id", quoted: false, trailing_comments: [] },
      table: tableAlias ? { name: tableAlias, quoted: false, trailing_comments: [] } : null,
      join_mark: false,
      trailing_comments: [],
    },
  };

  return {
    eq: {
      left: column,
      right: {
        parameter: {
          name: "projectId",
          index: null,
          style: "Brace",
          quoted: false,
          string_quoted: false,
          expression: "UUID",
        },
      },
      left_comments: [],
      operator_comments: [],
      trailing_comments: [],
    },
  };
}

/**
 * Wrap an existing condition with AND, adding a new condition on the left.
 */
function andConditions(
  newCond: Record<string, unknown>,
  existingCond: Record<string, unknown>,
): Record<string, unknown> {
  return {
    and: {
      left: newCond,
      right: existingCond,
      left_comments: [],
      operator_comments: [],
      trailing_comments: [],
    },
  };
}

/**
 * Inject project_id filters on all table references in the AST.
 * - For the FROM table: inject into WHERE clause
 * - For JOINed tables: inject into JOIN ON condition
 * - For subqueries: recurse
 */
function injectProjectFilters(ast: unknown[]): void {
  for (const stmt of ast) {
    injectIntoStatement(stmt as Record<string, unknown>);
  }
}

function injectIntoStatement(stmt: Record<string, unknown>): void {
  // Handle UNION/INTERSECT/EXCEPT
  if ("union" in stmt || "intersect" in stmt || "except" in stmt) {
    const setOp = stmt.union || stmt.intersect || stmt.except;
    if (setOp && typeof setOp === "object") {
      const setOpObj = setOp as Record<string, unknown>;
      if (setOpObj.left) injectIntoStatement(setOpObj.left as Record<string, unknown>);
      if (setOpObj.right) injectIntoStatement(setOpObj.right as Record<string, unknown>);
    }
    return;
  }

  if (!("select" in stmt)) return;
  const select = stmt.select as Record<string, unknown>;

  // Get the FROM table alias for qualifying the project_id filter
  const from = select.from as Record<string, unknown> | null;
  if (!from) return; // SELECT 1 — no table to filter

  const fromExprs = from.expressions as unknown[];
  if (!fromExprs?.length) return;

  // Inject on ALL FROM expressions (handles comma-joined tables like FROM traces, spans)
  for (const fromExpr of fromExprs) {
    const fromObj = fromExpr as Record<string, unknown>;

    if ("table" in fromObj) {
      const tableNode = fromObj.table as Record<string, unknown>;
      const alias = tableNode.alias as { name: string } | null;
      const tableName = (tableNode.name as { name: string })?.name;

      // Don't inject on CTE references — they'll get injection on their inner query
      if (tableName && ALLOWED_TABLES.has(tableName)) {
        const qualifier = alias?.name ?? null;
        const cond = buildProjectIdCondition(qualifier);
        const existing = select.where_clause as Record<string, unknown> | null;

        if (existing) {
          select.where_clause = { this: andConditions(cond, existing.this as Record<string, unknown>) };
        } else {
          select.where_clause = { this: cond };
        }
      }
    }

    // Also check if FROM has a subquery
    if ("select" in fromObj) {
      injectIntoStatement(fromObj);
    }
  }

  // Inject on JOINed tables
  const joins = select.joins as unknown[];
  if (joins?.length) {
    for (const join of joins) {
      const joinObj = join as Record<string, unknown>;
      const joinTarget = joinObj.this as Record<string, unknown>;

      if (joinTarget && "table" in joinTarget) {
        const tableNode = joinTarget.table as Record<string, unknown>;
        const alias = tableNode.alias as { name: string } | null;
        const tableName = (tableNode.name as { name: string })?.name;

        if (tableName && ALLOWED_TABLES.has(tableName)) {
          const qualifier = alias?.name ?? null;
          const cond = buildProjectIdCondition(qualifier);
          const existingOn = joinObj.on as Record<string, unknown> | null;

          if (existingOn) {
            joinObj.on = andConditions(existingOn, cond);
          } else {
            joinObj.on = cond;
          }
        }
      }

      // Handle subquery JOINs
      if (joinTarget && "select" in joinTarget) {
        injectIntoStatement(joinTarget);
      }
    }
  }

  // Recurse into subqueries in WHERE clause, SELECT expressions, etc.
  injectIntoSubqueries(select);
}

/**
 * Find and recurse into subqueries within SELECT, WHERE, HAVING, etc.
 */
function injectIntoSubqueries(node: unknown): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach((item) => injectIntoSubqueries(item));
    return;
  }

  const obj = node as Record<string, unknown>;

  // If this node contains a select (subquery), inject into it
  if ("select" in obj && obj.select && typeof obj.select === "object") {
    const selectNode = obj.select as Record<string, unknown>;
    // Check if this is a full SELECT statement (has expressions)
    if ("expressions" in selectNode) {
      injectIntoStatement(obj);
    }
  }

  // Recurse into child nodes, but skip keys we've already handled
  for (const key of Object.keys(obj)) {
    if (key === "from" || key === "joins") continue; // Handled by injectIntoStatement
    injectIntoSubqueries(obj[key]);
  }
}

function isProjectIdCondition(
  node: Record<string, unknown>,
  tableAlias: string | null,
): boolean {
  if (!("eq" in node) || !node.eq || typeof node.eq !== "object") return false;
  const eqNode = node.eq as Record<string, unknown>;
  const left = eqNode.left as Record<string, unknown> | undefined;
  const right = eqNode.right as Record<string, unknown> | undefined;
  if (!left || !right) return false;

  const columnWrapper = left.column as Record<string, unknown> | undefined;
  const columnName = columnWrapper?.name as { name?: string } | undefined;
  const columnTable = columnWrapper?.table as { name?: string } | null | undefined;
  const parameter = right.parameter as { name?: string } | undefined;

  return (
    columnName?.name === "project_id" &&
    (tableAlias ? columnTable?.name === tableAlias : columnTable == null) &&
    parameter?.name === "projectId"
  );
}

function stripLeadingProjectFilter(
  node: Record<string, unknown>,
  tableAlias: string,
): Record<string, unknown> {
  if (!("and" in node) || !node.and || typeof node.and !== "object") {
    return node;
  }

  const andNode = node.and as Record<string, unknown>;
  const left = andNode.left as Record<string, unknown> | undefined;
  const right = andNode.right as Record<string, unknown> | undefined;

  if (left && right && isProjectIdCondition(left, tableAlias)) {
    return right;
  }

  return node;
}

// ── Main entry point ───────────────────────────────────────────────

/**
 * Initialize the WASM parser. Must be called once before using
 * validateAndRewriteQuery. Safe to call multiple times.
 */
export async function initQueryValidator(): Promise<void> {
  await ensureInit();
}

/**
 * Validate and rewrite a SQL query for safe execution.
 *
 * 1. Parse the SQL into an AST
 * 2. Validate: only SELECT, only allowed tables and functions
 * 3. Inject project_id filters on every table reference
 * 4. Regenerate safe SQL
 * 5. Double-parse: parse the generated SQL and re-validate
 *
 * Throws QueryValidationError if the query is invalid.
 * Must call initQueryValidator() once before first use.
 */
export function validateAndRewriteQuery(
  sql: string,
  projectId: string,
): string {
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

  // Step 1: Parse
  const { ast } = parseSQL(sql);

  // Step 2: Validate statement types
  validateStatements(ast);

  // Step 3: Validate tables, functions, settings (including UNION arms)
  validateUnionArms(ast);

  // Step 4: Inject project_id filters
  injectProjectFilters(ast);

  // Step 5: Generate SQL
  const generatedSql = generateSQL(ast);

  // Step 6: Double-parse — parse the generated SQL and re-validate
  // This catches parser bugs where a node was silently dropped
  const { ast: ast2 } = parseSQL(generatedSql);
  validateStatements(ast2);
  validateUnionArms(ast2);

  // Step 7: Verify project_id filters were actually injected
  // Count real table references (excluding CTEs) and verify each has a filter
  const { tables: revalidatedTables, cteNames: revalidatedCtes } = collectAstInfo(ast2);
  const realTables = revalidatedTables.filter(
    (t) => ALLOWED_TABLES.has(t.name) && !revalidatedCtes.has(t.name),
  );
  if (realTables.length > 0) {
    // Verify the generated SQL contains project_id references
    // Each real table should have a corresponding project_id filter
    const projectIdCount = (generatedSql.match(/project_id/g) || []).length;
    if (projectIdCount < realTables.length) {
      throw new QueryValidationError(
        "FILTER_INJECTION_FAILED",
        "Failed to inject project_id filters on all table references",
        [`Expected at least ${realTables.length} project_id filter(s), found ${projectIdCount}`],
      );
    }
  }

  return generatedSql;
}

/**
 * Validate and rewrite an arbitrary WHERE clause fragment used in traces.list.
 *
 * The clause is wrapped in a fixed SELECT so all referenced tables/functions
 * are validated and any subqueries receive injected project_id filters.
 * The wrapper's own outer project filter is stripped before returning the
 * final clause SQL, because the caller already scopes the outer trace query.
 */
export function validateAndRewriteWhereClause(
  clause: string,
  projectId: string,
): string {
  const wrappedSql =
    `SELECT 1 FROM traces t LEFT JOIN trace_rollups r ON t.id = r.trace_id WHERE ${clause}`;
  const { ast } = parseSQL(wrappedSql);

  validateStatements(ast);
  validateUnionArms(ast);
  injectProjectFilters(ast);

  const stmt = ast[0] as Record<string, unknown>;
  const select = stmt.select as Record<string, unknown> | undefined;
  const whereClause = select?.where_clause as Record<string, unknown> | undefined;
  const whereNode = whereClause?.this as Record<string, unknown> | undefined;
  if (!select || !whereClause || !whereNode) {
    throw new QueryValidationError(
      "FILTER_INJECTION_FAILED",
      "Failed to rewrite WHERE clause",
      ["Wrapper query did not produce a WHERE clause"],
    );
  }

  select.where_clause = {
    this: stripLeadingProjectFilter(whereNode, "t"),
  };

  const generatedSql = generateSQL(ast);
  const whereIndex = generatedSql.toUpperCase().indexOf(" WHERE ");
  if (whereIndex === -1) {
    throw new QueryValidationError(
      "GENERATE_ERROR",
      "Failed to extract rewritten WHERE clause",
      ["Generated SQL missing WHERE clause"],
    );
  }

  return generatedSql.slice(whereIndex + 7).trim();
}

/**
 * Validate a query that might be a UNION/INTERSECT/EXCEPT,
 * recursing into each arm.
 */
function validateUnionArms(ast: unknown[]): void {
  const stmt = ast[0] as Record<string, unknown>;

  if ("union" in stmt || "intersect" in stmt || "except" in stmt) {
    const setOp = (stmt.union || stmt.intersect || stmt.except) as Record<string, unknown>;
    if (setOp.left) validateUnionArms([setOp.left]);
    if (setOp.right) validateUnionArms([setOp.right]);
    return;
  }

  if ("select" in stmt) {
    validateAst(ast);
  }
}
