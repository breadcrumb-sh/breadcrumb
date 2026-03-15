import { Hono } from "hono";
import { clickhouse } from "../../shared/db/clickhouse.js";
import { ClickHouseBatcher } from "../../shared/db/clickhouse-batcher.js";
import { TraceSchema, SpanSchema } from "./schemas.js";
import { toMicroDollars, toJson, toChDate } from "../../services/ingest/helpers.js";
import { boss } from "../../shared/lib/boss.js";
import { getObservationsForProject } from "../../services/observations/cache.js";
import { createLogger } from "../../shared/lib/logger.js";

const log = createLogger("ingest");

type Variables = { projectId: string };

// ── Batchers ─────────────────────────────────────────────────────────────────

export const traceBatcher = new ClickHouseBatcher(clickhouse, "breadcrumb.traces");
export const spanBatcher = new ClickHouseBatcher(clickhouse, "breadcrumb.spans");

// ── Routes ────────────────────────────────────────────────────────────────────

export const ingestRoutes = new Hono<{ Variables: Variables }>();

ingestRoutes.post("/traces", async (c) => {
  const projectId = c.get("projectId");
  const body = await c.req.json().catch(() => null);

  if (body === null) {
    return c.json({ error: "Invalid JSON in request body" }, 400);
  }

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

  if (t.end_time) {
    void scheduleObservationJobs(projectId, t.id, t.name);
  }

  return c.json({ ok: true }, 202);
});

ingestRoutes.post("/spans", async (c) => {
  const projectId = c.get("projectId");
  const body = await c.req.json().catch(() => null);

  if (body === null) {
    return c.json({ error: "Invalid JSON in request body" }, 400);
  }

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

// ── Background job scheduling ─────────────────────────────────────────────────

async function scheduleObservationJobs(
  projectId: string,
  traceId: string,
  traceName: string,
) {
  try {
    const obs = await getObservationsForProject(projectId);
    const matching = obs.filter(
      (o) => o.traceNames.length === 0 || o.traceNames.includes(traceName),
    );
    for (const o of matching) {
      const roll = Math.random() * 100;
      if (roll >= o.samplingRate) continue;
      await boss.send(
        "evaluate-observation",
        { projectId, traceId, observationId: o.id },
        {
          startAfter: 15,
          singletonKey: `${o.id}:${traceId}`,
        },
      );
    }
  } catch (err) {
    log.error({ err, projectId, traceId }, "scheduleObservationJobs error");
  }
}
