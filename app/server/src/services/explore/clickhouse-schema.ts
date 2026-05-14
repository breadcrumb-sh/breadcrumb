/**
 * Shared ClickHouse schema description used by AI-powered query/chart generators.
 */
export const CLICKHOUSE_SCHEMA = `
-- Traces (use subquery alias "t" — already deduplicated with argMax):
--   t.id            String        -- trace ID
--   t.name          String        -- trace name
--   t.status        String        -- 'ok' | 'error'
--   t.status_message String
--   t.start_time    DateTime64(3) -- UTC
--   t.end_time      Nullable(DateTime64(3))
--   t.user_id       String
--   t.environment   String        -- e.g. 'production', 'staging'

-- Spans table (breadcrumb.spans):
--   id              String
--   trace_id        String
--   parent_span_id  String        -- empty string = root span
--   project_id      UUID
--   name            String
--   type            String        -- 'llm' | 'tool' | 'retrieval' | 'step' | 'custom'
--   start_time      DateTime64(3)
--   end_time        DateTime64(3)
--   status          String        -- 'ok' | 'error'
--   status_message  String
--   input           String        -- JSON
--   output          String        -- JSON
--   provider        String        -- e.g. 'openai', 'anthropic'
--   model           String        -- e.g. 'gpt-4o', 'claude-sonnet-4-20250514'
--   input_tokens    UInt32
--   output_tokens   UInt32
--   input_cost_usd  UInt64        -- micro-dollars (1 USD = 1,000,000)
--   output_cost_usd UInt64        -- micro-dollars
--   metadata        Map(String, String)

-- Rollups (subquery alias "r" — already joined):
--   r.input_tokens   UInt64
--   r.output_tokens  UInt64
--   r.span_count     UInt64
--   r.max_end_time   DateTime64(3)
--   r.input_cost_usd  UInt64      -- micro-dollars
--   r.output_cost_usd UInt64      -- micro-dollars
`.trim();
