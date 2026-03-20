import { z } from "zod";

// ── Legend / Chart spec ─────────────────────────────────────────────────────

export const legendEntrySchema = z.object({
  key: z.string(),
  label: z.string(),
  color: z.string(),
});

export type LegendEntry = z.infer<typeof legendEntrySchema>;

export const chartSpecSchema = z.object({
  title: z.string(),
  chartType: z.enum(["bar", "line"]),
  sql: z.string(),
  xKey: z.string(),
  yKeys: z.array(z.string()),
  legend: z.array(legendEntrySchema).optional(),
  /** Default lookback window in days (7, 30, or 90). Used on the dashboard. */
  defaultDays: z.number().int().positive().optional(),
});

export type ChartSpec = z.infer<typeof chartSpecSchema>;

// ── Display parts (persisted in DB, rendered in UI) ─────────────────────────

export type DisplayPart =
  | { type: "user"; content: string }
  | { type: "text"; content: string }
  | { type: "tool-loading"; toolName: string }
  | { type: "chart"; spec: ChartSpec; data: Record<string, unknown>[] };

// ── Stream events (yielded by the tRPC subscription) ────────────────────────

export type StreamEvent =
  | { type: "text-delta"; content: string }
  | { type: "tool-call"; toolName: string; args: unknown }
  | { type: "tool-result"; toolName: string; result: unknown }
  | { type: "chart"; spec: ChartSpec; data: Record<string, unknown>[] }
  | { type: "error"; message: string }
  | { type: "done"; name?: string };
