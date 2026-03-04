import { Hono } from "hono";
import { clickhouse } from "../db/clickhouse.js";
import { ClickHouseBatcher } from "../db/clickhouse-batcher.js";
import { TraceSchema, SpanSchema } from "./schemas.js";
import { toMicroDollars, toJson, toChDate } from "./helpers.js";

type Variables = { projectId: string };

// ── Batchers ─────────────────────────────────────────────────────────────────

export const traceBatcher = new ClickHouseBatcher(clickhouse, "breadcrumb.traces");
export const spanBatcher = new ClickHouseBatcher(clickhouse, "breadcrumb.spans");

// ── Routes ────────────────────────────────────────────────────────────────────

export const ingestRoutes = new Hono<{ Variables: Variables }>();

// POST /v1/traces
//
// Called twice per trace by the SDK:
//   1. trace.start() — sends id, name, start_time, resource attributes
//   2. trace.end()   — sends same id + end_time, status, output
//
// Both insert a row into ClickHouse. ReplacingMergeTree(version) keeps
// the row with the highest version (unix ms), so trace.end() wins.
// The rollup (tokens, cost) lives in trace_rollups — not here.
ingestRoutes.post("/traces", async (c) => {
  const projectId = c.get("projectId");
  const body = await c.req.json().catch(() => null);

  const parsed = TraceSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const t = parsed.data;

  traceBatcher.add([{
    id:             t.id,
    project_id:     projectId,
    version:        t.end_time ? new Date(t.end_time).getTime() : new Date(t.start_time).getTime(),
    name:           t.name,
    start_time:     toChDate(t.start_time),
    end_time:       t.end_time ? toChDate(t.end_time) : null,
    status:         t.status,
    status_message: t.status_message ?? "",
    input:          toJson(t.input),
    output:         toJson(t.output),
    user_id:        t.user_id ?? "",
    session_id:     t.session_id ?? "",
    environment:    t.environment ?? "",
    tags:           t.tags ?? {},
  }]);

  return c.json({ ok: true }, 202);
});

// POST /v1/spans
//
// Accepts a single span object or an array of spans.
// The SDK sends each span as it completes, but batching is supported
// for SDKs that buffer and flush (e.g. on trace.end()).
//
// Each span insert also triggers the spans_to_rollups materialized view
// which automatically accumulates tokens/cost into trace_rollups.
ingestRoutes.post("/spans", async (c) => {
  const projectId = c.get("projectId");
  const body = await c.req.json().catch(() => null);

  const raw = Array.isArray(body) ? body : [body];

  const spans = [];
  for (const item of raw) {
    const parsed = SpanSchema.safeParse(item);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    const s = parsed.data;
    spans.push({
      id:             s.id,
      trace_id:       s.trace_id,
      parent_span_id: s.parent_span_id ?? "",
      project_id:     projectId,
      name:           s.name,
      type:           s.type,
      start_time:     toChDate(s.start_time),
      end_time:       toChDate(s.end_time),
      status:         s.status,
      status_message: s.status_message ?? "",
      input:          toJson(s.input),
      output:         toJson(s.output),
      provider:       s.provider ?? "",
      model:          s.model ?? "",
      input_tokens:   s.input_tokens ?? 0,
      output_tokens:  s.output_tokens ?? 0,
      input_cost_usd:  toMicroDollars(s.input_cost_usd),
      output_cost_usd: toMicroDollars(s.output_cost_usd),
      metadata:       s.metadata ?? {},
    });
  }

  spanBatcher.add(spans);

  return c.json({ ok: true }, 202);
});
