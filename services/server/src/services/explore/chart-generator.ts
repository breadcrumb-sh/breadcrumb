import { streamText, tool, stepCountIs } from "ai";
import type { LanguageModel, ModelMessage } from "ai";
import { z } from "zod";
import { CLICKHOUSE_SCHEMA } from "./clickhouse-schema.js";
import { runSandboxedQuery } from "../../shared/lib/sandboxed-query.js";
import { getProjectTimezone } from "../traces/helpers.js";
import { chartSpecSchema, type ChartSpec } from "./types.js";

export { chartSpecSchema, type ChartSpec };

const SYSTEM_PROMPT = `You are a data exploration assistant for a tracing/observability platform.

You help users explore their trace and span data by running SQL queries and displaying chart visualizations.
You can also write markdown (tables, mermaid diagrams, code blocks, etc.) in your text responses — the UI renders them natively.

You have two tools:
1. **run_query** — Run a ClickHouse SELECT query to explore data. Use this to understand the shape of the data before charting, or when the user just wants raw results. The query results are NOT shown to the user — you must summarize or format them in your text response.
2. **display_chart** — Display a chart visualization. This executes the SQL and renders a chart widget in the UI.

WORKFLOW:
- When the user asks for a chart, first use run_query to explore the data if needed (e.g. check available columns, date ranges, distinct values).
- Then use display_chart to show the visualization.
- If a query fails, read the error and fix your SQL, then try again.
- For simple requests, you can skip run_query and go directly to display_chart.
- When the user asks for tabular data, use run_query and then format the results as a markdown table in your text response.
- For architecture or flow diagrams, write mermaid code blocks in your text response.
- The chat UI is narrow (~700px). When writing mermaid diagrams, prefer top-down layout (TD/TB) over left-right (LR). If comparing multiple flows or subgraphs, render each as a SEPARATE mermaid code block rather than combining them into one wide diagram.

SCHEMA:
${CLICKHOUSE_SCHEMA}

SQL RULES:
- Write complete SELECT statements.
- Always filter by project_id using ClickHouse parameterized syntax: {projectId: UUID}
  IMPORTANT: You MUST include the type annotation. Write {projectId: UUID}, NOT {projectId} alone.
- Use ClickHouse syntax: toDate(), toStartOfDay(), formatDateTime(), etc.
- When grouping by day/date, always apply the project timezone: toDate(column, {tz: String}). The tz parameter is automatically provided.
- For cost values, divide micro-dollar columns by 1000000 to get USD.
- Alias columns to short, readable names (e.g. "date", "count", "cost").
- The xKey and yKeys in display_chart must exactly match your SELECT aliases.
- Order results appropriately (usually by date/time ascending).
- NEVER produce destructive statements — SELECT only.

TIME RANGE RULES (for time-series charts):
- NEVER hard-code dates or use now() directly. Instead, use these parameters which are automatically provided:
    {now: DateTime}   — the current UTC timestamp at query execution time
    {days: UInt32}    — the lookback window in days (set by the user on the dashboard)
- Filter time ranges like this:
    WHERE t.start_time >= {now: DateTime} - toIntervalDay({days: UInt32})
      AND t.start_time < {now: DateTime}
- You can still use {tz: String} for date bucketing:
    toDate(t.start_time, {tz: String})
- In display_chart, set defaultDays to 7, 30, or 90 — whichever best matches the natural
  granularity of the chart (e.g. 7 for hourly breakdowns, 30 for daily trends, 90 for weekly views).
  This becomes the default range shown on the dashboard, but users can override it.

CHART RULES:
- Use "line" for time-series data (trends over time).
- Use "bar" for categorical comparisons (top N, distributions).
- The legend key must match a yKey.
- You do NOT need to specify colors in legend entries — they are assigned automatically.

Keep your text responses brief — the user cares about the chart, not long explanations.`;

const MAX_QUERY_ROWS = 50;
const MAX_RESULT_CHARS = 5000;

function truncateResult(rows: Record<string, unknown>[]): string {
  const truncated = rows.slice(0, MAX_QUERY_ROWS);
  let json = JSON.stringify(truncated, null, 2);
  if (json.length > MAX_RESULT_CHARS) {
    json = json.slice(0, MAX_RESULT_CHARS) + "\n... (truncated)";
  }
  if (rows.length > MAX_QUERY_ROWS) {
    json += `\n(showing ${MAX_QUERY_ROWS} of ${rows.length} rows)`;
  }
  return json;
}

/**
 * Streams an agentic chart generation session.
 * The LLM can call run_query and display_chart tools iteratively.
 * Returns the streamText result for the caller to iterate fullStream.
 */
/** Returns the current UTC time in ClickHouse DateTime format: 'YYYY-MM-DD HH:MM:SS' */
function nowClickhouse(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

export function streamChartGeneration({
  model,
  messages,
  projectId,
  abortSignal,
  traceContext,
  onChartUpdate,
}: {
  model: LanguageModel;
  messages: ModelMessage[];
  projectId: string;
  abortSignal?: AbortSignal;
  traceContext?: string;
  onChartUpdate?: (spec: ChartSpec, data: Record<string, unknown>[]) => void;
}) {
  const tzPromise = getProjectTimezone(projectId);
  const systemPrompt = traceContext
    ? `${SYSTEM_PROMPT}\n\n${traceContext}`
    : SYSTEM_PROMPT;

  return streamText({
    abortSignal,
    model,
    system: systemPrompt,
    messages,
    stopWhen: stepCountIs(10),
    tools: {
      run_query: tool({
        description:
          "Execute a ClickHouse SELECT query to explore data. Returns rows as JSON. Use this to understand the data before creating a chart.",
        inputSchema: z.object({
          sql: z.string().describe("The ClickHouse SELECT query to run"),
        }),
        execute: async ({ sql }) => {
          try {
            const tz = await tzPromise;
            const now = nowClickhouse();
            const rows = await runSandboxedQuery(projectId, sql, "explore", {
              tz,
              now,
              days: 30,
            }, { abortSignal });
            return {
              success: true as const,
              rowCount: rows.length,
              data: truncateResult(rows),
            };
          } catch (err) {
            return {
              success: false as const,
              error:
                err instanceof Error ? err.message : "Query execution failed",
            };
          }
        },
      }),
      display_chart: tool({
        description:
          "Display a chart visualization. Executes the SQL and renders the chart. Call this when you're ready to show a chart to the user.",
        inputSchema: z.object({
          title: z.string().describe("Chart title"),
          chartType: z.enum(["bar", "line"]).describe("Chart type"),
          sql: z.string().describe("ClickHouse SELECT query for the chart"),
          xKey: z.string().describe("Column alias for x-axis"),
          yKeys: z.array(z.string()).describe("Column aliases for y-axis"),
          defaultDays: z
            .number()
            .int()
            .positive()
            .describe(
              "Default lookback window in days: 7, 30, or 90. Choose based on the natural granularity of the chart."
            ),
          legend: z
            .array(
              z.object({
                key: z.string(),
                label: z.string(),
                color: z.string(),
              })
            )
            .optional()
            .describe("Legend entries with display labels and hex colors"),
        }),
        execute: async ({
          title,
          chartType,
          sql,
          xKey,
          yKeys,
          defaultDays,
          legend,
        }) => {
          try {
            const tz = await tzPromise;
            const now = nowClickhouse();
            const rows = await runSandboxedQuery(projectId, sql, "explore", {
              tz,
              now,
              days: defaultDays,
            }, { abortSignal });
            const spec: ChartSpec = {
              title,
              chartType,
              sql,
              xKey,
              yKeys,
              legend,
              defaultDays,
            };

            onChartUpdate?.(spec, rows);

            return {
              success: true as const,
              rowCount: rows.length,
              message: `Chart displayed with ${rows.length} rows.`,
            };
          } catch (err) {
            return {
              success: false as const,
              error:
                err instanceof Error ? err.message : "Query execution failed",
            };
          }
        },
      }),
    },
    temperature: 0,
  });
}
