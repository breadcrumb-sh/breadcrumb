import { generateText } from "ai";
import type { LanguageModel } from "ai";

const SCHEMA = `
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

const SYSTEM_PROMPT = `You are a ClickHouse SQL filter writer for a tracing/observability platform.

Given a user's natural language search query, output ONLY a ClickHouse WHERE clause fragment that filters traces. The clause will be AND-ed with existing filters.

SCHEMA:
${SCHEMA}

RULES:
- Output ONLY the raw SQL condition — no SELECT, no WHERE keyword, no semicolons, no markdown, no explanation.
- Reference trace columns with the "t." prefix (e.g. t.name, t.status).
- Reference rollup columns with the "r." prefix (e.g. r.input_tokens).
- To filter by span-level data (model, provider, input, output, span name, type, metadata), use a subquery:
    t.id IN (SELECT DISTINCT trace_id FROM breadcrumb.spans WHERE project_id = {projectId: UUID} AND <condition>)
- Use ClickHouse syntax: ilike for case-insensitive matching, has() for arrays, toString() where needed.
- String comparisons should be case-insensitive where reasonable (use ilike or lower()).
- For cost comparisons, remember values are stored in micro-dollars (multiply dollar amounts by 1000000).
- Use only parameterized values with ClickHouse syntax {name: Type} when possible, but for search terms from the user query you may inline string literals safely escaped with single quotes.
- If the user query is too vague, ambiguous, or lacks sufficient context to write a meaningful filter, output exactly: NOOP
- NEVER produce destructive statements or anything other than a boolean expression.

EXAMPLES:
User: "traces with errors"
Output: t.status = 'error'

User: "requests using gpt-4o"
Output: t.id IN (SELECT DISTINCT trace_id FROM breadcrumb.spans WHERE project_id = {projectId: UUID} AND model ilike '%gpt-4o%')

User: "traces costing more than $1"
Output: (r.input_cost_usd + r.output_cost_usd) > 1000000

User: "long running traces over 5 seconds"
Output: toInt64(toUnixTimestamp64Milli(coalesce(t.end_time, r.max_end_time))) - toInt64(toUnixTimestamp64Milli(t.start_time)) > 5000

User: "hello"
Output: NOOP`;

interface QueryWriterInput {
  model: LanguageModel;
  query: string;
  activeFilters?: string[];
}

export interface QueryWriterResult {
  clause: string | null;
}

/**
 * Uses an AI model to convert a natural language search query into
 * a ClickHouse WHERE clause fragment. Returns { clause: null } if
 * the query is too vague or the model can't produce a meaningful filter.
 */
export async function writeSearchQuery(
  input: QueryWriterInput
): Promise<QueryWriterResult> {
  const filterContext =
    input.activeFilters && input.activeFilters.length > 0
      ? `\nAlready-applied filters (for context, do not duplicate): ${input.activeFilters.join(", ")}`
      : "";

  const { text } = await generateText({
    model: input.model,
    system: SYSTEM_PROMPT,
    prompt: `${input.query}${filterContext}`,
    temperature: 0,
    maxOutputTokens: 512,
  });

  const trimmed = text.trim();

  if (!trimmed || trimmed === "NOOP") {
    return { clause: null };
  }

  return { clause: trimmed };
}
