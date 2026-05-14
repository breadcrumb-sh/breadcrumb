-- ============================================================
-- Row-Level Security for Sandboxed Queries
-- ============================================================
--
-- Replaces application-level SQL rewriting (AST injection of
-- project_id filters) with native ClickHouse row policies.
--
-- How it works:
--   1. A custom setting SQL_project_id is passed per-query.
--   2. Row policies on traces, spans, and trace_rollups filter
--      rows to only those matching the setting value.
--   3. The breadcrumb_sandbox user has readonly=1, so it cannot
--      change any settings except SQL_project_id (marked
--      CHANGEABLE_IN_READONLY on the role).
--   4. Resource limits (timeouts, row caps, memory) are baked
--      into the role — no per-query overrides needed.
--
-- Security properties:
--   - Missing SQL_project_id → zero rows (deny-by-default)
--   - readonly=1 → no DDL, DML, or setting overrides
--   - GRANT scoped to breadcrumb.* → no system table access
--   - Resource limits enforced at role level
-- ============================================================

-- Role: read-only with custom setting + resource limits
CREATE ROLE IF NOT EXISTS breadcrumb_sandbox
  SETTINGS
    SQL_project_id CHANGEABLE_IN_READONLY,
    max_execution_time = 30,
    max_result_rows = 10000,
    result_overflow_mode = 'throw',
    max_result_bytes = 1048576,
    max_rows_to_read = 1000000,
    max_bytes_to_read = 25000000,
    max_memory_usage = 500000000;

GRANT SELECT ON breadcrumb.* TO breadcrumb_sandbox;

-- Row policies: filter every SELECT by the per-query project ID
CREATE ROW POLICY IF NOT EXISTS traces_isolation ON breadcrumb.traces
  USING project_id = toUUID(getSetting('SQL_project_id'))
  TO breadcrumb_sandbox;

CREATE ROW POLICY IF NOT EXISTS spans_isolation ON breadcrumb.spans
  USING project_id = toUUID(getSetting('SQL_project_id'))
  TO breadcrumb_sandbox;

CREATE ROW POLICY IF NOT EXISTS rollups_isolation ON breadcrumb.trace_rollups
  USING project_id = toUUID(getSetting('SQL_project_id'))
  TO breadcrumb_sandbox;

-- Sandbox user: readonly=1 blocks all setting changes except
-- those marked CHANGEABLE_IN_READONLY on the role
CREATE USER IF NOT EXISTS breadcrumb_sandbox
  IDENTIFIED BY 'breadcrumb_sandbox_local'
  SETTINGS readonly = 1;

GRANT breadcrumb_sandbox TO breadcrumb_sandbox;

SET DEFAULT ROLE breadcrumb_sandbox TO breadcrumb_sandbox;
