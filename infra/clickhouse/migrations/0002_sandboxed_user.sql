-- Sandboxed ClickHouse user for AI-generated and user-supplied queries.
--
-- Uses per-query custom setting SQL_project_id + row policies for project isolation.
-- Server must have custom_settings_prefixes including 'SQL_' (ClickHouse default).
--
-- Three layers of defense:
--   1. Row policies (DB-enforced) — project_id = toUUID(getSetting('SQL_project_id'))
--   2. readonly=2 + GRANT only on breadcrumb.* — no writes, no system tables
--   3. Application-level sanitizeSql() strips SETTINGS clauses from user SQL

CREATE USER IF NOT EXISTS ai_query IDENTIFIED WITH no_password;

-- readonly=2 allows changing settings (needed for SQL_project_id) but blocks writes.
-- Resource limits prevent DoS via expensive queries.
ALTER USER ai_query SETTINGS
  readonly = 2,
  max_execution_time = 10,
  max_rows_to_read = 1000000,
  max_result_rows = 10000,
  max_memory_usage = 100000000;

-- Grant only SELECT on breadcrumb database (no system.* access)
GRANT SELECT ON breadcrumb.* TO ai_query;

-- Revoke access to internal tables
REVOKE SELECT ON breadcrumb.spans_to_rollups FROM ai_query;
REVOKE SELECT ON breadcrumb.schema_migrations FROM ai_query;

-- Row policies — enforce project isolation at DB level.
-- getSetting('SQL_project_id') reads the per-query custom setting.
-- If the setting is not provided, the query FAILS (fail-closed).
-- If a wrong project UUID is provided, 0 rows are returned.
CREATE ROW POLICY IF NOT EXISTS project_filter_traces
  ON breadcrumb.traces
  USING project_id = toUUID(getSetting('SQL_project_id'))
  TO ai_query;

CREATE ROW POLICY IF NOT EXISTS project_filter_spans
  ON breadcrumb.spans
  USING project_id = toUUID(getSetting('SQL_project_id'))
  TO ai_query;

CREATE ROW POLICY IF NOT EXISTS project_filter_rollups
  ON breadcrumb.trace_rollups
  USING project_id = toUUID(getSetting('SQL_project_id'))
  TO ai_query
