-- ============================================================
-- Cache and reasoning token breakdown on spans
-- ============================================================
--
-- Adds three optional columns for fine-grained token accounting:
--
--   cached_input_tokens          — tokens served from prompt cache
--                                  (billed at the cheaper cache-read rate)
--   cache_creation_input_tokens  — tokens written to prompt cache
--                                  (billed at the more expensive cache-write rate)
--   reasoning_tokens             — reasoning / thinking tokens
--                                  (o-series, Claude extended thinking, etc.)
--
-- All three are UInt32 and default to 0 so existing spans remain valid.
-- They do NOT feed the trace_rollups materialized view: input_tokens and
-- output_tokens already include these (per provider convention), and the
-- per-span cost columns already reflect the correct per-bucket pricing
-- because the ingest pipeline splits the total by these breakdowns before
-- computing input_cost_usd / output_cost_usd.
-- ============================================================

ALTER TABLE breadcrumb.spans
  ADD COLUMN IF NOT EXISTS cached_input_tokens UInt32 DEFAULT 0;

ALTER TABLE breadcrumb.spans
  ADD COLUMN IF NOT EXISTS cache_creation_input_tokens UInt32 DEFAULT 0;

ALTER TABLE breadcrumb.spans
  ADD COLUMN IF NOT EXISTS reasoning_tokens UInt32 DEFAULT 0;
