import { z } from "zod";

// W3C Trace Context ID formats:
//   trace id — 32-char lowercase hex (128-bit)
//   span id  — 16-char lowercase hex (64-bit)
export const traceIdSchema = z.string().regex(/^[0-9a-f]{32}$/, "trace id must be 32-char hex");
export const spanIdSchema  = z.string().regex(/^[0-9a-f]{16}$/, "span id must be 16-char hex");

export const TraceSchema = z.object({
  id:             traceIdSchema,
  name:           z.string().min(1),
  start_time:     z.string().datetime(),
  // end_time and output are absent on trace.start(), present on trace.end()
  end_time:       z.string().datetime().optional(),
  status:         z.enum(["ok", "error"]).default("ok"),
  status_message: z.string().optional(),
  input:          z.unknown().optional(),
  output:         z.unknown().optional(),
  user_id:        z.string().optional(),
  session_id:     z.string().optional(),
  environment:    z.string().optional(),
  tags:           z.record(z.string()).optional(),
});

export const SpanSchema = z.object({
  id:             spanIdSchema,
  trace_id:       traceIdSchema,
  parent_span_id: spanIdSchema.optional(),
  name:           z.string().min(1),
  type:           z.enum(["llm", "tool", "retrieval", "step", "custom"]),
  start_time:     z.string().datetime(),
  end_time:       z.string().datetime(),
  status:         z.enum(["ok", "error"]).default("ok"),
  status_message: z.string().optional(),
  input:          z.unknown().optional(),
  output:         z.unknown().optional(),
  provider:        z.string().optional(),
  model:           z.string().optional(),
  input_tokens:    z.number().int().nonnegative().optional(),
  output_tokens:   z.number().int().nonnegative().optional(),
  // Float USD from the SDK — converted to micro-dollars before storage.
  // See toMicroDollars() in ingest/index.ts.
  input_cost_usd:  z.number().nonnegative().optional(),
  output_cost_usd: z.number().nonnegative().optional(),
  metadata:        z.record(z.string()).optional(),
});

export type Trace = z.infer<typeof TraceSchema>;
export type Span  = z.infer<typeof SpanSchema>;
