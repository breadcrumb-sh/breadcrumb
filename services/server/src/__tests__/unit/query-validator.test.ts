import { describe, it, expect, beforeAll } from "vitest";
import {
  validateAndRewriteQuery,
  QueryValidationError,
  initQueryValidator,
} from "../../shared/lib/query-validator.js";

const PROJECT_ID = "00000000-0000-0000-0000-000000000001";

beforeAll(async () => {
  await initQueryValidator();
});

// ── Statement type validation ──────────────────────────────────────

describe("statement type validation", () => {
  it("allows SELECT statements", () => {
    const result = validateAndRewriteQuery(
      "SELECT name FROM traces",
      PROJECT_ID,
    );
    expect(result).toContain("SELECT");
  });

  it("rejects INSERT statements", () => {
    expect(() =>
      validateAndRewriteQuery(
        "INSERT INTO traces (id) VALUES ('x')",
        PROJECT_ID,
      ),
    ).toThrow(QueryValidationError);
  });

  it("rejects DROP TABLE", () => {
    expect(() =>
      validateAndRewriteQuery("DROP TABLE traces", PROJECT_ID),
    ).toThrow(QueryValidationError);
  });

  it("rejects ALTER TABLE", () => {
    expect(() =>
      validateAndRewriteQuery(
        "ALTER TABLE traces ADD COLUMN x String",
        PROJECT_ID,
      ),
    ).toThrow(QueryValidationError);
  });

  it("rejects CREATE TABLE", () => {
    expect(() =>
      validateAndRewriteQuery(
        "CREATE TABLE evil (id String) ENGINE = MergeTree()",
        PROJECT_ID,
      ),
    ).toThrow(QueryValidationError);
  });

  it("rejects DELETE", () => {
    expect(() =>
      validateAndRewriteQuery(
        "DELETE FROM traces WHERE id = 'x'",
        PROJECT_ID,
      ),
    ).toThrow(QueryValidationError);
  });

  it("rejects TRUNCATE TABLE", () => {
    expect(() =>
      validateAndRewriteQuery("TRUNCATE TABLE traces", PROJECT_ID),
    ).toThrow(QueryValidationError);
  });

  it("rejects multiple statements", () => {
    expect(() =>
      validateAndRewriteQuery("SELECT 1; DROP TABLE traces", PROJECT_ID),
    ).toThrow(QueryValidationError);
  });

  it("rejects empty string", () => {
    expect(() => validateAndRewriteQuery("", PROJECT_ID)).toThrow(
      QueryValidationError,
    );
  });
});

// ── Table allowlist ────────────────────────────────────────────────

describe("table allowlist", () => {
  it("allows traces table", () => {
    const result = validateAndRewriteQuery(
      "SELECT * FROM traces",
      PROJECT_ID,
    );
    expect(result).toContain("traces");
  });

  it("allows spans table", () => {
    const result = validateAndRewriteQuery(
      "SELECT * FROM spans",
      PROJECT_ID,
    );
    expect(result).toContain("spans");
  });

  it("allows trace_rollups table", () => {
    const result = validateAndRewriteQuery(
      "SELECT * FROM trace_rollups",
      PROJECT_ID,
    );
    expect(result).toContain("trace_rollups");
  });

  it("allows database-qualified table names", () => {
    const result = validateAndRewriteQuery(
      "SELECT * FROM breadcrumb.traces",
      PROJECT_ID,
    );
    expect(result).toContain("traces");
  });

  it("rejects system.processes", () => {
    expect(() =>
      validateAndRewriteQuery(
        "SELECT * FROM system.processes",
        PROJECT_ID,
      ),
    ).toThrow(QueryValidationError);
  });

  it("rejects system.query_log", () => {
    expect(() =>
      validateAndRewriteQuery(
        "SELECT * FROM system.query_log",
        PROJECT_ID,
      ),
    ).toThrow(QueryValidationError);
  });

  it("rejects schema_migrations", () => {
    expect(() =>
      validateAndRewriteQuery(
        "SELECT * FROM schema_migrations",
        PROJECT_ID,
      ),
    ).toThrow(QueryValidationError);
  });

  it("rejects nonexistent_table", () => {
    expect(() =>
      validateAndRewriteQuery(
        "SELECT * FROM nonexistent_table",
        PROJECT_ID,
      ),
    ).toThrow(QueryValidationError);
  });

  it("rejects disallowed table in subquery", () => {
    expect(() =>
      validateAndRewriteQuery(
        "SELECT * FROM traces WHERE id IN (SELECT id FROM system.processes)",
        PROJECT_ID,
      ),
    ).toThrow(QueryValidationError);
  });

  it("rejects disallowed table in JOIN", () => {
    expect(() =>
      validateAndRewriteQuery(
        "SELECT * FROM traces JOIN system.processes ON traces.id = system.processes.id",
        PROJECT_ID,
      ),
    ).toThrow(QueryValidationError);
  });
});

// ── Function allowlist ─────────────────────────────────────────────

describe("function allowlist", () => {
  it("allows standard aggregates", () => {
    const result = validateAndRewriteQuery(
      "SELECT count(), sum(input_tokens), avg(input_tokens), min(input_tokens), max(input_tokens) FROM spans",
      PROJECT_ID,
    );
    expect(result).toContain("count()");
  });

  it("allows date/time functions", () => {
    const result = validateAndRewriteQuery(
      "SELECT toDate(start_time), toStartOfHour(start_time), formatDateTime(start_time, '%F') FROM spans",
      PROJECT_ID,
    );
    expect(result).toContain("toDate");
  });

  it("allows string functions", () => {
    const result = validateAndRewriteQuery(
      "SELECT lower(name), upper(name), length(name) FROM spans",
      PROJECT_ID,
    );
    // Generator may uppercase function names
    expect(result.toLowerCase()).toContain("lower");
  });

  it("allows conditional functions", () => {
    const result = validateAndRewriteQuery(
      "SELECT if(status = 'error', 1, 0), coalesce(name, 'unknown') FROM spans",
      PROJECT_ID,
    );
    expect(result).toBeDefined();
  });

  it("allows argMax (used extensively in codebase)", () => {
    const result = validateAndRewriteQuery(
      "SELECT argMax(name, start_time) FROM traces",
      PROJECT_ID,
    );
    expect(result).toContain("argMax");
  });

  it("rejects url() function", () => {
    expect(() =>
      validateAndRewriteQuery(
        "SELECT url('http://evil.com') FROM spans",
        PROJECT_ID,
      ),
    ).toThrow(QueryValidationError);
  });

  it("rejects file() function", () => {
    expect(() =>
      validateAndRewriteQuery(
        "SELECT file('/etc/passwd') FROM spans",
        PROJECT_ID,
      ),
    ).toThrow(QueryValidationError);
  });

  it("rejects remote() function", () => {
    expect(() =>
      validateAndRewriteQuery(
        "SELECT remote('host', 'db', 'table') FROM spans",
        PROJECT_ID,
      ),
    ).toThrow(QueryValidationError);
  });

  it("rejects mysql() function", () => {
    expect(() =>
      validateAndRewriteQuery(
        "SELECT mysql('host', 'db', 'table', 'user', 'pass') FROM spans",
        PROJECT_ID,
      ),
    ).toThrow(QueryValidationError);
  });

  it("rejects postgresql() function", () => {
    expect(() =>
      validateAndRewriteQuery(
        "SELECT postgresql('host', 'db', 'table', 'user', 'pass') FROM spans",
        PROJECT_ID,
      ),
    ).toThrow(QueryValidationError);
  });

  it("rejects input() function", () => {
    expect(() =>
      validateAndRewriteQuery(
        "SELECT input('format') FROM spans",
        PROJECT_ID,
      ),
    ).toThrow(QueryValidationError);
  });

  it("handles function names case-insensitively", () => {
    // Allowed
    const r1 = validateAndRewriteQuery(
      "SELECT COUNT() FROM spans",
      PROJECT_ID,
    );
    expect(r1).toContain("COUNT");

    // Rejected regardless of case
    expect(() =>
      validateAndRewriteQuery(
        "SELECT URL('http://evil.com') FROM spans",
        PROJECT_ID,
      ),
    ).toThrow(QueryValidationError);
  });
});

// ── Project filter injection ───────────────────────────────────────

describe("project filter injection", () => {
  it("injects project_id on simple query", () => {
    const result = validateAndRewriteQuery(
      "SELECT * FROM spans",
      PROJECT_ID,
    );
    expect(result).toContain("project_id");
    expect(result).toContain("{projectId: UUID}");
  });

  it("injects project_id on both tables in a JOIN", () => {
    const result = validateAndRewriteQuery(
      "SELECT t.name FROM traces t LEFT JOIN spans s ON t.id = s.trace_id",
      PROJECT_ID,
    );
    // Should have project_id filter for both tables
    const projectIdCount = (result.match(/project_id/g) || []).length;
    expect(projectIdCount).toBeGreaterThanOrEqual(2);
  });

  it("injects project_id in subqueries", () => {
    const result = validateAndRewriteQuery(
      "SELECT * FROM traces WHERE id IN (SELECT trace_id FROM spans)",
      PROJECT_ID,
    );
    // Both the outer traces and inner spans should get project_id
    const projectIdCount = (result.match(/project_id/g) || []).length;
    expect(projectIdCount).toBeGreaterThanOrEqual(2);
  });

  it("adds filter even when query already has project_id", () => {
    const result = validateAndRewriteQuery(
      "SELECT * FROM spans WHERE project_id = {projectId: UUID}",
      PROJECT_ID,
    );
    // Should still contain project_id (redundant is safe)
    expect(result).toContain("project_id");
  });

  it("injects project_id on ALL comma-joined FROM tables", () => {
    const result = validateAndRewriteQuery(
      "SELECT * FROM traces, spans",
      PROJECT_ID,
    );
    // Both tables must get project_id filters — at least 2 occurrences
    const projectIdCount = (result.match(/project_id/g) || []).length;
    expect(projectIdCount).toBeGreaterThanOrEqual(2);
  });

  it("injects project_id on three comma-joined FROM tables", () => {
    const result = validateAndRewriteQuery(
      "SELECT * FROM traces, spans, trace_rollups",
      PROJECT_ID,
    );
    // All three tables must get project_id filters
    const projectIdCount = (result.match(/project_id/g) || []).length;
    expect(projectIdCount).toBeGreaterThanOrEqual(3);
  });
});

// ── ClickHouse parameter preservation ──────────────────────────────

describe("ClickHouse parameter preservation", () => {
  it("preserves {projectId: UUID}", () => {
    const result = validateAndRewriteQuery(
      "SELECT * FROM spans WHERE project_id = {projectId: UUID}",
      PROJECT_ID,
    );
    expect(result).toContain("{projectId: UUID}");
  });

  it("preserves {tz: String}", () => {
    const result = validateAndRewriteQuery(
      "SELECT formatDateTime(start_time, '%F', {tz: String}) FROM spans",
      PROJECT_ID,
    );
    expect(result).toContain("{tz: String}");
  });

  it("preserves {now: DateTime}", () => {
    const result = validateAndRewriteQuery(
      "SELECT * FROM spans WHERE start_time <= {now: DateTime}",
      PROJECT_ID,
    );
    expect(result).toContain("{now: DateTime}");
  });

  it("preserves {days: UInt32}", () => {
    const result = validateAndRewriteQuery(
      "SELECT * FROM spans WHERE start_time >= now() - INTERVAL {days: UInt32} DAY",
      PROJECT_ID,
    );
    expect(result).toContain("{days: UInt32}");
  });

  it("preserves {models: Array(String)}", () => {
    const result = validateAndRewriteQuery(
      "SELECT * FROM spans WHERE model IN {models: Array(String)}",
      PROJECT_ID,
    );
    expect(result).toContain("{models: Array(String)}");
  });

  it("preserves parameters inside function arguments", () => {
    const result = validateAndRewriteQuery(
      "SELECT formatDateTime(start_time, '%F', {tz: String}) FROM spans",
      PROJECT_ID,
    );
    expect(result).toContain("{tz: String}");
  });
});

// ── Query limits ───────────────────────────────────────────────────

describe("query limits", () => {
  it("rejects queries exceeding max length", () => {
    const longQuery = `SELECT * FROM spans WHERE name = '${"x".repeat(10_001)}'`;
    expect(() =>
      validateAndRewriteQuery(longQuery, PROJECT_ID),
    ).toThrow(QueryValidationError);
  });

  it("rejects queries exceeding max length with QUERY_TOO_LONG code", () => {
    const longQuery = `SELECT * FROM spans WHERE name = '${"x".repeat(10_001)}'`;
    try {
      validateAndRewriteQuery(longQuery, PROJECT_ID);
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(QueryValidationError);
      expect((err as InstanceType<typeof QueryValidationError>).code).toBe(
        "QUERY_TOO_LONG",
      );
    }
  });

  it("allows queries within length limit", () => {
    const sql = `SELECT * FROM spans WHERE name = '${"x".repeat(100)}'`;
    const result = validateAndRewriteQuery(sql, PROJECT_ID);
    expect(result).toContain("spans");
  });
});

// ── Attack vectors ─────────────────────────────────────────────────

describe("attack vectors", () => {
  it("rejects SETTINGS override attempt", () => {
    expect(() =>
      validateAndRewriteQuery(
        "SELECT 1 FROM spans SETTINGS SQL_project_id = 'evil'",
        PROJECT_ID,
      ),
    ).toThrow(QueryValidationError);
  });

  it("rejects UNION escape to system tables", () => {
    expect(() =>
      validateAndRewriteQuery(
        "SELECT * FROM spans UNION ALL SELECT * FROM system.processes",
        PROJECT_ID,
      ),
    ).toThrow(QueryValidationError);
  });

  it("rejects subquery escape to system tables", () => {
    expect(() =>
      validateAndRewriteQuery(
        "SELECT * FROM spans WHERE id IN (SELECT * FROM system.query_log)",
        PROJECT_ID,
      ),
    ).toThrow(QueryValidationError);
  });

  it("ignores comments (does not execute commented-out SQL)", () => {
    // Comments are preserved as text in output but are NOT parsed as table references.
    // The parser correctly ignores them — system.processes is not in the AST,
    // so it passes validation. The comment text in the output is harmless.
    const result = validateAndRewriteQuery(
      "SELECT * FROM spans -- SELECT * FROM system.processes",
      PROJECT_ID,
    );
    expect(result).toContain("spans");
    expect(result).toContain("project_id");
  });

  it("allows string literals containing table names (not actual references)", () => {
    const result = validateAndRewriteQuery(
      "SELECT 'system.processes' AS label FROM spans",
      PROJECT_ID,
    );
    expect(result).toContain("'system.processes'");
  });

  it("rejects nested dangerous function calls", () => {
    expect(() =>
      validateAndRewriteQuery(
        "SELECT url(concat('http://', 'evil.com')) FROM spans",
        PROJECT_ID,
      ),
    ).toThrow(QueryValidationError);
  });

  it("rejects getSetting() — leaks server configuration", () => {
    expect(() =>
      validateAndRewriteQuery(
        "SELECT getSetting('max_threads') FROM spans",
        PROJECT_ID,
      ),
    ).toThrow(QueryValidationError);
  });

  it("rejects range() — DoS via row generation", () => {
    expect(() =>
      validateAndRewriteQuery(
        "SELECT * FROM spans WHERE id IN (SELECT toString(number) FROM (SELECT range(1, 1000000000)))",
        PROJECT_ID,
      ),
    ).toThrow(QueryValidationError);
  });
});

// ── Table-valued functions in FROM ─────────────────────────────────

describe("table-valued functions in FROM position", () => {
  it("rejects numbers() table function", () => {
    expect(() =>
      validateAndRewriteQuery(
        "SELECT number FROM numbers(100)",
        PROJECT_ID,
      ),
    ).toThrow(QueryValidationError);
  });

  it("rejects generateRandom() table function", () => {
    expect(() =>
      validateAndRewriteQuery(
        "SELECT * FROM generateRandom('x UInt64', 1, 1, 1)",
        PROJECT_ID,
      ),
    ).toThrow(QueryValidationError);
  });

  it("rejects merge() table function", () => {
    expect(() =>
      validateAndRewriteQuery(
        "SELECT * FROM merge('default', '.*')",
        PROJECT_ID,
      ),
    ).toThrow(QueryValidationError);
  });

  it("rejects cluster() table function", () => {
    expect(() =>
      validateAndRewriteQuery(
        "SELECT * FROM cluster('cluster_name', 'db', 'table')",
        PROJECT_ID,
      ),
    ).toThrow(QueryValidationError);
  });
});

// ── Edge cases ─────────────────────────────────────────────────────

describe("edge cases", () => {
  it("handles CTE (WITH clause) — validates real tables, allows CTE names", () => {
    const result = validateAndRewriteQuery(
      "WITH cte AS (SELECT * FROM spans) SELECT * FROM cte",
      PROJECT_ID,
    );
    expect(result).toContain("cte");
    // project_id should be injected on the spans table inside the CTE
    expect(result).toContain("project_id");
  });

  it("handles table aliases", () => {
    const result = validateAndRewriteQuery(
      "SELECT t.name FROM traces t",
      PROJECT_ID,
    );
    expect(result).toContain("traces");
    expect(result).toContain("project_id");
  });

  it("allows SELECT 1 (no FROM clause)", () => {
    const result = validateAndRewriteQuery("SELECT 1", PROJECT_ID);
    expect(result).toContain("SELECT 1");
  });

  it("handles window functions", () => {
    const result = validateAndRewriteQuery(
      "SELECT *, row_number() OVER (PARTITION BY trace_id ORDER BY start_time) FROM spans",
      PROJECT_ID,
    );
    expect(result).toContain("row_number");
  });

  it("handles CASE WHEN", () => {
    const result = validateAndRewriteQuery(
      "SELECT CASE WHEN status = 'error' THEN 1 ELSE 0 END FROM spans",
      PROJECT_ID,
    );
    expect(result).toContain("CASE");
  });

  it("handles complex real-world chart query", () => {
    const sql = `
      SELECT
        toDate(t.start_time, {tz: String}) AS date,
        sum((r.input_cost_usd + r.output_cost_usd) / 1000000) AS cost_usd
      FROM traces t
      LEFT JOIN trace_rollups r ON t.id = r.trace_id
      WHERE t.start_time >= now() - INTERVAL {days: UInt32} DAY
      GROUP BY date
      ORDER BY date
    `;
    const result = validateAndRewriteQuery(sql, PROJECT_ID);
    expect(result).toContain("project_id");
    expect(result).toContain("{tz: String}");
    expect(result).toContain("{days: UInt32}");
  });

  it("provides error code and details on validation failure", () => {
    try {
      validateAndRewriteQuery(
        "SELECT * FROM system.processes",
        PROJECT_ID,
      );
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(QueryValidationError);
      const validationErr = err as InstanceType<typeof QueryValidationError>;
      expect(validationErr.code).toBeDefined();
      expect(validationErr.details).toBeInstanceOf(Array);
      expect(validationErr.details.length).toBeGreaterThan(0);
    }
  });
});
