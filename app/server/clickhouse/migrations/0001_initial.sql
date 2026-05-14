-- ============================================================
-- Breadcrumb ClickHouse Schema
-- ============================================================
--
-- Design principles:
--
--   1. INSERT-ONLY for spans. Spans are written once when they
--      complete and never updated or deleted.
--
--   2. ReplacingMergeTree for traces. A trace row is inserted
--      on start and again on end (with a higher version). CH
--      deduplicates in the background, keeping the highest version.
--      Query with argMax(), not FINAL — see traces table below.
--
--   3. AggregatingMergeTree + SimpleAggregateFunction for rollups.
--      Every span insert automatically feeds trace_rollups via a
--      materialized view. CH merges rows in the background using
--      the declared aggregate function (sum or max).
--      Always query with the matching aggregate function (sum(),
--      max()) and explicit GROUP BY — not FINAL.
--
--   4. Costs stored as UInt64 micro-dollars (1 USD = 1_000_000).
--      Float64 accumulates precision errors when summing many
--      small values. Integer arithmetic is exact. Divide by
--      1_000_000 at display time.
--
--   5. LowCardinality(String) for fields with few distinct values
--      (status, type, provider, environment). Dramatically reduces
--      storage and speeds up filtering on these columns.
--
--   6. traces.end_time is Nullable. The first row (trace.start())
--      inserts NULL — the trace appears in the dashboard immediately.
--      If trace.end() is called, a second row with a real end_time
--      overwrites it (ReplacingMergeTree, higher version).
--      Trace duration is always derived from span times via
--      trace_rollups.max_end_time, so a missing trace.end_time
--      never causes a broken duration display.
--
-- ============================================================

CREATE DATABASE IF NOT EXISTS breadcrumb;

-- ============================================================
-- traces
-- ============================================================
-- One logical trace = up to two physical rows:
--   version 1 — inserted by SDK on trace.start() with metadata
--   version 2 — inserted by SDK on trace.end() with final status/output
--
-- ReplacingMergeTree(version) deduplicates by ORDER BY key
-- (project_id, id), keeping the row with the highest version.
-- Deduplication happens in the background — not guaranteed at
-- read time.
--
-- DO NOT use FINAL to read this table. FINAL forces a synchronous
-- merge, disables parallel reads, and degrades badly at scale.
--
-- Use the argMax pattern instead:
--
--   SELECT
--     id,
--     argMax(name, version)           AS name,
--     argMax(start_time, version)     AS start_time,
--     argMax(end_time, version)       AS end_time,   -- Nullable
--     argMax(status, version)         AS status,
--     argMax(status_message, version) AS status_message,
--     argMax(user_id, version)        AS user_id,
--     argMax(environment, version)    AS environment
--   FROM breadcrumb.traces
--   WHERE project_id = ?
--   GROUP BY id
--
-- end_time is NULL when only trace.start() has been received.
-- Use COALESCE(end_time, rollup.max_end_time) for duration.
-- ============================================================

CREATE TABLE IF NOT EXISTS breadcrumb.traces
(
    -- Identity
    id          String,   -- 32-char hex trace ID (W3C Trace Context format)
    project_id  UUID,
    version     UInt64,   -- Unix milliseconds. ReplacingMergeTree keeps the highest.

    -- Metadata — set on trace.start(), unchanged on trace.end()
    name        String,
    start_time  DateTime64(3, 'UTC'),

    -- Nullable: NULL in the version=1 row (trace.start()), real value in version=2 (trace.end())
    -- Duration is always derived from span times — see trace_rollups.max_end_time
    end_time       Nullable(DateTime64(3, 'UTC')),
    status         LowCardinality(String) DEFAULT 'ok', -- 'ok' | 'error'
    status_message String DEFAULT '',
    input          String DEFAULT '', -- JSON: initial input to the trace
    output         String DEFAULT '', -- JSON: final output of the trace

    -- Resource attributes for filtering traces
    user_id     String DEFAULT '',
    session_id  String DEFAULT '',
    environment LowCardinality(String) DEFAULT '',

    -- Arbitrary key-value pairs for any extra filtering needs.
    -- Query: WHERE tags['key'] = 'value'
    tags Map(String, String) DEFAULT map()
)
ENGINE = ReplacingMergeTree(version)
PARTITION BY toYYYYMM(start_time)
ORDER BY (project_id, id);

-- ============================================================
-- spans
-- ============================================================
-- Append-only. One row inserted per span when span.end() is
-- called by the SDK. Rows are never updated or deleted.
-- ============================================================

CREATE TABLE IF NOT EXISTS breadcrumb.spans
(
    -- Identity / tree structure
    id             String,        -- 16-char hex span ID (W3C Trace Context format)
    trace_id       String,
    parent_span_id String DEFAULT '', -- Empty string means this is a root span
    project_id     UUID,

    -- Classification
    name String,
    type LowCardinality(String), -- 'llm' | 'tool' | 'retrieval' | 'step' | 'custom'

    -- Timing (always present — spans are only inserted on span.end())
    start_time DateTime64(3, 'UTC'),
    end_time   DateTime64(3, 'UTC'),

    -- Status
    status         LowCardinality(String) DEFAULT 'ok', -- 'ok' | 'error'
    status_message String DEFAULT '',

    -- Input / output (always JSON strings)
    input  String DEFAULT '',
    output String DEFAULT '',

    -- LLM-specific fields (zero/empty for non-LLM spans)
    provider LowCardinality(String) DEFAULT '',
    model    LowCardinality(String) DEFAULT '',
    input_tokens  UInt32 DEFAULT 0,
    output_tokens UInt32 DEFAULT 0,

    -- Micro-dollars: 1 USD = 1_000_000. Divide by 1_000_000 at display time.
    input_cost_usd  UInt64 DEFAULT 0,
    output_cost_usd UInt64 DEFAULT 0,

    -- Arbitrary key-value metadata from the SDK caller
    metadata Map(String, String) DEFAULT map()
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(start_time)
ORDER BY (project_id, trace_id, start_time, id);

-- ============================================================
-- trace_rollups
-- ============================================================
-- Accumulated token, cost, span count, and max end time per trace.
-- Populated automatically by spans_to_rollups (below).
--
-- Uses AggregatingMergeTree with SimpleAggregateFunction columns.
-- SimpleAggregateFunction stores partial values directly (no
-- state serialisation needed) and merges them in the background
-- using the declared function (sum or max).
--
-- ALWAYS query with the matching aggregate function and GROUP BY:
--
--   SELECT
--     trace_id,
--     sum(input_tokens)                     AS input_tokens,
--     sum(output_tokens)                    AS output_tokens,
--     sum(input_cost_usd + output_cost_usd) AS total_cost_usd,
--     sum(span_count)                       AS span_count,
--     max(max_end_time)                     AS max_end_time
--   FROM breadcrumb.trace_rollups
--   WHERE project_id = ?
--   GROUP BY trace_id
--
-- max_end_time = the latest span.end_time for this trace.
-- Use COALESCE(trace.end_time, rollup.max_end_time) for duration
-- so that traces without an explicit trace.end() call still show
-- a real duration as long as they have at least one completed span.
-- ============================================================

CREATE TABLE IF NOT EXISTS breadcrumb.trace_rollups
(
    project_id      UUID,
    trace_id        String,
    input_tokens    SimpleAggregateFunction(sum, UInt64),
    output_tokens   SimpleAggregateFunction(sum, UInt64),
    input_cost_usd  SimpleAggregateFunction(sum, UInt64),
    output_cost_usd SimpleAggregateFunction(sum, UInt64),
    span_count      SimpleAggregateFunction(sum, UInt64),
    max_end_time    SimpleAggregateFunction(max, DateTime64(3, 'UTC'))
)
ENGINE = AggregatingMergeTree()
PARTITION BY tuple()
ORDER BY (project_id, trace_id);

-- ============================================================
-- spans_to_rollups (materialized view)
-- ============================================================
-- Fires on every INSERT into breadcrumb.spans.
-- Extracts cost/token fields and the span end_time, inserting
-- them into trace_rollups for background aggregation.
-- ============================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS breadcrumb.spans_to_rollups
TO breadcrumb.trace_rollups AS
SELECT
    project_id,
    trace_id,
    input_tokens,
    output_tokens,
    input_cost_usd,
    output_cost_usd,
    1            AS span_count,
    end_time     AS max_end_time
FROM breadcrumb.spans;
