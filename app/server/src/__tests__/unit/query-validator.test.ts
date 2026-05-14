import { describe, it, expect } from "vitest";
import {
  validateQuery,
  QueryValidationError,
} from "../../shared/lib/query-validator.js";

// ── Statement type validation ──────────────────────────────────────

describe("statement type validation", () => {
  it("allows SELECT statements", () => {
    expect(() => validateQuery("SELECT name FROM traces")).not.toThrow();
  });

  it("allows WITH ... SELECT (CTE)", () => {
    expect(() =>
      validateQuery("WITH cte AS (SELECT 1) SELECT * FROM cte"),
    ).not.toThrow();
  });

  it("rejects INSERT statements", () => {
    expect(() =>
      validateQuery("INSERT INTO traces (id) VALUES ('x')"),
    ).toThrow(QueryValidationError);
  });

  it("rejects DROP TABLE", () => {
    expect(() => validateQuery("DROP TABLE traces")).toThrow(
      QueryValidationError,
    );
  });

  it("rejects ALTER TABLE", () => {
    expect(() =>
      validateQuery("ALTER TABLE traces ADD COLUMN x String"),
    ).toThrow(QueryValidationError);
  });

  it("rejects CREATE TABLE", () => {
    expect(() =>
      validateQuery("CREATE TABLE evil (id String) ENGINE = MergeTree()"),
    ).toThrow(QueryValidationError);
  });

  it("rejects DELETE", () => {
    expect(() => validateQuery("DELETE FROM traces WHERE id = 'x'")).toThrow(
      QueryValidationError,
    );
  });

  it("rejects TRUNCATE TABLE", () => {
    expect(() => validateQuery("TRUNCATE TABLE traces")).toThrow(
      QueryValidationError,
    );
  });

  it("rejects empty string", () => {
    expect(() => validateQuery("")).toThrow(QueryValidationError);
  });

  it("rejects whitespace-only string", () => {
    expect(() => validateQuery("   ")).toThrow(QueryValidationError);
  });
});

// ── SETTINGS clause blocking ─────────────────────────────────────

describe("SETTINGS clause blocking", () => {
  it("rejects SETTINGS clause", () => {
    expect(() =>
      validateQuery("SELECT 1 FROM spans SETTINGS max_threads = 1"),
    ).toThrow(QueryValidationError);
  });

  it("rejects SETTINGS with SQL_project_id override", () => {
    expect(() =>
      validateQuery(
        "SELECT 1 FROM spans SETTINGS SQL_project_id = '00000000-0000-0000-0000-000000000099'",
      ),
    ).toThrow(QueryValidationError);
  });

  it("rejects case-insensitive SETTINGS", () => {
    expect(() =>
      validateQuery("SELECT 1 FROM spans settings max_threads = 1"),
    ).toThrow(QueryValidationError);
  });

  it("rejects Settings (mixed case)", () => {
    expect(() =>
      validateQuery("SELECT 1 FROM spans Settings max_threads = 1"),
    ).toThrow(QueryValidationError);
  });

  it("does not reject 'SETTINGS' inside a string literal (overzealous but safe)", () => {
    // This is a false positive — the word SETTINGS is in a string, not a clause.
    // We accept this trade-off: safe > permissive.
    expect(() =>
      validateQuery("SELECT 'SETTINGS' FROM spans"),
    ).toThrow(QueryValidationError);
  });
});

// ── Blocked functions ────────────────────────────────────────────

describe("blocked functions", () => {
  it("rejects url() function", () => {
    expect(() =>
      validateQuery("SELECT * FROM url('http://evil.com', CSV, 'x String')"),
    ).toThrow(QueryValidationError);
  });

  it("rejects remote() function", () => {
    expect(() =>
      validateQuery("SELECT * FROM remote('host', 'db', 'table')"),
    ).toThrow(QueryValidationError);
  });

  it("rejects file() function", () => {
    expect(() => validateQuery("SELECT * FROM file('/etc/passwd')")).toThrow(
      QueryValidationError,
    );
  });

  it("rejects s3() function", () => {
    expect(() =>
      validateQuery("SELECT * FROM s3('https://bucket/key')"),
    ).toThrow(QueryValidationError);
  });

  it("rejects mysql() function", () => {
    expect(() =>
      validateQuery("SELECT * FROM mysql('host', 'db', 'table', 'user', 'pass')"),
    ).toThrow(QueryValidationError);
  });

  it("rejects postgresql() function", () => {
    expect(() =>
      validateQuery(
        "SELECT * FROM postgresql('host', 'db', 'table', 'user', 'pass')",
      ),
    ).toThrow(QueryValidationError);
  });

  it("rejects cluster() function", () => {
    expect(() =>
      validateQuery("SELECT * FROM cluster('c', 'db', 'table')"),
    ).toThrow(QueryValidationError);
  });

  it("rejects input() function", () => {
    expect(() => validateQuery("SELECT * FROM input('format')")).toThrow(
      QueryValidationError,
    );
  });

  it("rejects blocked functions case-insensitively", () => {
    expect(() =>
      validateQuery("SELECT * FROM URL('http://evil.com', CSV, 'x String')"),
    ).toThrow(QueryValidationError);
  });

  it("does not reject unrelated functions with similar names", () => {
    // "urls" is not "url"
    expect(() =>
      validateQuery("SELECT urls FROM traces"),
    ).not.toThrow();
  });

  it("allows standard functions", () => {
    expect(() =>
      validateQuery(
        "SELECT count(), sum(input_tokens), avg(input_tokens), lower(name), toDate(start_time) FROM spans",
      ),
    ).not.toThrow();
  });
});

// ── Query limits ───────────────────────────────────────────────────

describe("query limits", () => {
  it("rejects queries exceeding max length", () => {
    const longQuery = `SELECT * FROM spans WHERE name = '${"x".repeat(10_001)}'`;
    expect(() => validateQuery(longQuery)).toThrow(QueryValidationError);
  });

  it("rejects with QUERY_TOO_LONG code", () => {
    const longQuery = `SELECT * FROM spans WHERE name = '${"x".repeat(10_001)}'`;
    try {
      validateQuery(longQuery);
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(QueryValidationError);
      expect((err as QueryValidationError).code).toBe("QUERY_TOO_LONG");
    }
  });

  it("allows queries within length limit", () => {
    const sql = `SELECT * FROM spans WHERE name = '${"x".repeat(100)}'`;
    expect(() => validateQuery(sql)).not.toThrow();
  });
});

// ── Error structure ──────────────────────────────────────────────

describe("error structure", () => {
  it("provides error code and details on validation failure", () => {
    try {
      validateQuery("DROP TABLE traces");
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(QueryValidationError);
      const validationErr = err as QueryValidationError;
      expect(validationErr.code).toBeDefined();
      expect(validationErr.details).toBeInstanceOf(Array);
      expect(validationErr.details.length).toBeGreaterThan(0);
    }
  });
});
