import { z } from "zod";

// W3C Trace Context ID formats:
//   trace id — 32-char lowercase hex (128-bit)
//   span id  — 16-char lowercase hex (64-bit)
export const traceIdSchema = z.string().regex(/^[0-9a-f]{32}$/, "trace id must be 32-char hex");
export const spanIdSchema  = z.string().regex(/^[0-9a-f]{16}$/, "span id must be 16-char hex");

const MAX_NAME_LENGTH = 255;
const MAX_STATUS_MESSAGE_LENGTH = 4096;
const MAX_USER_ID_LENGTH = 255;
const MAX_SESSION_ID_LENGTH = 255;
const MAX_ENVIRONMENT_LENGTH = 64;
const MAX_PROVIDER_LENGTH = 255;
const MAX_MODEL_LENGTH = 255;
const MAX_JSON_FIELD_LENGTH = 64 * 1024;
const MAX_RECORD_ENTRIES = 100;
const MAX_RECORD_KEY_LENGTH = 100;
const MAX_RECORD_VALUE_LENGTH = 1024;

function serializedJsonLength(value: unknown): number {
  if (value === undefined || value === null) return 0;
  if (typeof value === "string") return value.length;
  return JSON.stringify(value).length;
}

function boundedJsonField(fieldName: string) {
  return z.unknown().superRefine((value, ctx) => {
    if (serializedJsonLength(value) > MAX_JSON_FIELD_LENGTH) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${fieldName} exceeds ${MAX_JSON_FIELD_LENGTH} characters when serialized`,
      });
    }
  });
}

function boundedStringRecord(fieldName: string) {
  return z.record(z.string().max(MAX_RECORD_VALUE_LENGTH)).superRefine((value, ctx) => {
    const entries = Object.entries(value);
    if (entries.length > MAX_RECORD_ENTRIES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${fieldName} supports at most ${MAX_RECORD_ENTRIES} entries`,
      });
    }
    for (const [key, recordValue] of entries) {
      if (key.length > MAX_RECORD_KEY_LENGTH) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${fieldName} keys must be at most ${MAX_RECORD_KEY_LENGTH} characters`,
        });
      }
      if (recordValue.length > MAX_RECORD_VALUE_LENGTH) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${fieldName} values must be at most ${MAX_RECORD_VALUE_LENGTH} characters`,
        });
      }
    }
  });
}

export const TraceSchema = z.object({
  id:             traceIdSchema,
  name:           z.string().min(1).max(MAX_NAME_LENGTH),
  start_time:     z.string().datetime(),
  // end_time and output are absent on trace.start(), present on trace.end()
  end_time:       z.string().datetime().optional(),
  status:         z.enum(["ok", "error"]).default("ok"),
  status_message: z.string().max(MAX_STATUS_MESSAGE_LENGTH).optional(),
  input:          boundedJsonField("input").optional(),
  output:         boundedJsonField("output").optional(),
  user_id:        z.string().max(MAX_USER_ID_LENGTH).optional(),
  session_id:     z.string().max(MAX_SESSION_ID_LENGTH).optional(),
  environment:    z.string().max(MAX_ENVIRONMENT_LENGTH).optional(),
  tags:           boundedStringRecord("tags").optional(),
});

export const SpanSchema = z.object({
  id:             spanIdSchema,
  trace_id:       traceIdSchema,
  parent_span_id: spanIdSchema.optional(),
  name:           z.string().min(1).max(MAX_NAME_LENGTH),
  type:           z.enum(["llm", "tool", "retrieval", "step", "custom"]),
  start_time:     z.string().datetime(),
  end_time:       z.string().datetime(),
  status:         z.enum(["ok", "error"]).default("ok"),
  status_message: z.string().max(MAX_STATUS_MESSAGE_LENGTH).optional(),
  input:          boundedJsonField("input").optional(),
  output:         boundedJsonField("output").optional(),
  provider:        z.string().max(MAX_PROVIDER_LENGTH).optional(),
  model:           z.string().max(MAX_MODEL_LENGTH).optional(),
  input_tokens:    z.number().int().nonnegative().optional(),
  output_tokens:   z.number().int().nonnegative().optional(),
  // Breakdown of cache and reasoning tokens. These are subtotals already
  // included in input_tokens / output_tokens — populated by providers that
  // report them separately so we can bill at the correct per-bucket rate.
  cached_input_tokens:          z.number().int().nonnegative().optional(),
  cache_creation_input_tokens:  z.number().int().nonnegative().optional(),
  reasoning_tokens:             z.number().int().nonnegative().optional(),
  // Float USD from the SDK — converted to micro-dollars before storage.
  input_cost_usd:  z.number().nonnegative().optional(),
  output_cost_usd: z.number().nonnegative().optional(),
  metadata:        boundedStringRecord("metadata").optional(),
});

export type Trace = z.infer<typeof TraceSchema>;
export type Span  = z.infer<typeof SpanSchema>;
