import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { clickhouse } from "../../shared/db/clickhouse.js";
import { ClickHouseBatcher } from "../../shared/db/clickhouse-batcher.js";
import { TraceSchema, SpanSchema } from "./schemas.js";
import { toMicroDollars, toJson, toChDate } from "../../services/ingest/helpers.js";
import { createLogger } from "../../shared/lib/logger.js";
import { trackTraceIngested } from "../../shared/lib/telemetry.js";
import { enqueueScan } from "../../services/monitor/jobs.js";
import { getRedactor } from "../../services/ingest/pii-settings-cache.js";
import { redactString, redactRecord } from "../../services/ingest/pii-redactor.js";

const log = createLogger("ingest");

type Variables = { projectId: string };
const MAX_INGEST_BODY_BYTES = 1024 * 1024;
const MAX_SPANS_PER_REQUEST = 100;

function exceedsBodyLimit(body: unknown): boolean {
  return JSON.stringify(body).length > MAX_INGEST_BODY_BYTES;
}

type JsonBodyContext = {
  req: { json: () => Promise<unknown> };
  json: (body: unknown, status?: number) => Response;
};

async function parseJsonBody(c: JsonBodyContext): Promise<
  { body: unknown; error: null } | { body: null; error: Response }
> {
  try {
    return { body: await c.req.json(), error: null };
  } catch (err) {
    if (err instanceof Error && err.message === "Payload Too Large") {
      return {
        body: null,
        error: c.json({ error: "Request body too large" }, 413),
      };
    }
    return {
      body: null,
      error: c.json({ error: "Invalid JSON in request body" }, 400),
    };
  }
}

// ── Batchers ─────────────────────────────────────────────────────────────────

export const traceBatcher = new ClickHouseBatcher(clickhouse, "breadcrumb.traces");
export const spanBatcher = new ClickHouseBatcher(clickhouse, "breadcrumb.spans");

// ── Routes ────────────────────────────────────────────────────────────────────

export const ingestRoutes = new Hono<{ Variables: Variables }>();

ingestRoutes.use("*", bodyLimit({
  maxSize: MAX_INGEST_BODY_BYTES,
  onError: (c) => c.json({ error: "Request body too large" }, 413),
}));

ingestRoutes.post("/traces", async (c) => {
  const projectId = c.get("projectId");
  const { body, error } = await parseJsonBody(c);
  if (error) return error;
  if (exceedsBodyLimit(body)) {
    return c.json({ error: "Request body too large" }, 413);
  }

  const parsed = TraceSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }

  const t = parsed.data;
  const redactor = await getRedactor(projectId);

  let input = toJson(t.input);
  let output = toJson(t.output);
  let statusMessage = t.status_message ?? "";
  let tags = t.tags ?? {};
  if (redactor) {
    input = redactString(input, redactor);
    output = redactString(output, redactor);
    if (statusMessage) statusMessage = redactString(statusMessage, redactor);
    tags = redactRecord(tags, redactor);
  }

  traceBatcher.add([{
    id:             t.id,
    project_id:     projectId,
    version:        t.end_time ? new Date(t.end_time).getTime() : new Date(t.start_time).getTime(),
    name:           t.name,
    start_time:     toChDate(t.start_time),
    end_time:       t.end_time ? toChDate(t.end_time) : null,
    status:         t.status,
    status_message: statusMessage,
    input,
    output,
    user_id:        t.user_id ?? "",
    session_id:     t.session_id ?? "",
    environment:    t.environment ?? "",
    tags,
  }]);

  if (t.end_time) {
    trackTraceIngested();
    void enqueueScan(projectId);
  }

  return c.json({ ok: true }, 202);
});

ingestRoutes.post("/spans", async (c) => {
  const projectId = c.get("projectId");
  const { body, error } = await parseJsonBody(c);
  if (error) return error;
  if (exceedsBodyLimit(body)) {
    return c.json({ error: "Request body too large" }, 413);
  }

  const raw = Array.isArray(body) ? body : [body];
  if (raw.length > MAX_SPANS_PER_REQUEST) {
    return c.json(
      { error: `Too many spans in a single request (max ${MAX_SPANS_PER_REQUEST})` },
      400,
    );
  }

  const redactor = await getRedactor(projectId);
  const spans = [];
  for (const item of raw) {
    const parsed = SpanSchema.safeParse(item);
    if (!parsed.success) {
      return c.json({ error: parsed.error.flatten() }, 400);
    }
    const s = parsed.data;

    let input = toJson(s.input);
    let output = toJson(s.output);
    let statusMessage = s.status_message ?? "";
    let metadata = s.metadata ?? {};
    if (redactor) {
      input = redactString(input, redactor);
      output = redactString(output, redactor);
      if (statusMessage) statusMessage = redactString(statusMessage, redactor);
      metadata = redactRecord(metadata, redactor);
    }

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
      status_message: statusMessage,
      input,
      output,
      provider:       s.provider ?? "",
      model:          s.model ?? "",
      input_tokens:   s.input_tokens ?? 0,
      output_tokens:  s.output_tokens ?? 0,
      input_cost_usd:  toMicroDollars(s.input_cost_usd),
      output_cost_usd: toMicroDollars(s.output_cost_usd),
      metadata,
    });
  }

  spanBatcher.add(spans);

  return c.json({ ok: true }, 202);
});

