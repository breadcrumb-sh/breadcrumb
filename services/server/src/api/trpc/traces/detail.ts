import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { router, projectViewerProcedure, projectMemberProcedure } from "../../../trpc.js";
import { readonlyClickhouse } from "../../../shared/db/clickhouse.js";
import { db } from "../../../shared/db/postgres.js";
import { traceSummaries } from "../../../shared/db/schema.js";
import { toStr } from "../../../services/traces/helpers.js";
import { analyzeTrace } from "../../../services/traces/analyze.js";

const traceIdInput = z.object({
  projectId: z.string().uuid(),
  traceId: z.string().regex(/^[0-9a-f]{32}$/, "trace id must be 32-char hex"),
});

export const detailRouter = router({
  get: projectViewerProcedure
    .input(traceIdInput)
    .query(async ({ input }) => {
      const result = await readonlyClickhouse.query({
        query: `
          SELECT
            argMax(name, version)   AS name,
            argMax(status, version) AS status
          FROM breadcrumb.traces
          WHERE project_id = {projectId: UUID}
            AND id = {traceId: String}
          GROUP BY id
          LIMIT 1
        `,
        query_params: { projectId: input.projectId, traceId: input.traceId },
        format: "JSONEachRow",
      });
      const rows = (await result.json()) as Array<Record<string, unknown>>;
      if (!rows.length) return null;
      return {
        name:   String(rows[0]["name"]),
        status: String(rows[0]["status"]) as "ok" | "error",
      };
    }),

  spans: projectViewerProcedure
    .input(traceIdInput)
    .query(async ({ input }) => {
      const result = await readonlyClickhouse.query({
        query: `
          SELECT
            id, parent_span_id, name, type, status, status_message,
            start_time, end_time, provider, model,
            input_tokens, output_tokens, input_cost_usd, output_cost_usd,
            input, output, metadata
          FROM breadcrumb.spans
          WHERE project_id = {projectId: UUID}
            AND trace_id = {traceId: String}
          ORDER BY start_time ASC
        `,
        query_params: { projectId: input.projectId, traceId: input.traceId },
        format: "JSONEachRow",
      });

      const rows = (await result.json()) as Array<Record<string, unknown>>;

      return rows.map((r) => ({
        id:            String(r["id"]),
        parentSpanId:  String(r["parent_span_id"] ?? ""),
        name:          String(r["name"]),
        type:          String(r["type"]),
        status:        String(r["status"]) as "ok" | "error",
        statusMessage: String(r["status_message"] ?? ""),
        startTime:     String(r["start_time"]),
        endTime:       String(r["end_time"]),
        provider:      String(r["provider"] ?? ""),
        model:         String(r["model"] ?? ""),
        inputTokens:   Number(r["input_tokens"] ?? 0),
        outputTokens:  Number(r["output_tokens"] ?? 0),
        inputCostUsd:  Number(r["input_cost_usd"] ?? 0) / 1_000_000,
        outputCostUsd: Number(r["output_cost_usd"] ?? 0) / 1_000_000,
        input:         toStr(r["input"]),
        output:        toStr(r["output"]),
        metadata:      toStr(r["metadata"]),
      }));
    }),

  // ── Trace summary (analysis) ───────────────────────────────────────────

  summary: projectViewerProcedure
    .input(traceIdInput)
    .query(async ({ input }) => {
      const [row] = await db
        .select()
        .from(traceSummaries)
        .where(
          and(
            eq(traceSummaries.projectId, input.projectId),
            eq(traceSummaries.traceId, input.traceId),
          ),
        );
      if (!row) return null;
      return {
        id: row.id,
        markdown: row.markdown,
        status: row.status as "pending" | "running" | "done" | "error",
        errorMessage: row.errorMessage,
        updatedAt: row.updatedAt,
      };
    }),

  analyze: projectMemberProcedure
    .input(
      traceIdInput.extend({
        force: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      // Check for existing summary
      const [existing] = await db
        .select()
        .from(traceSummaries)
        .where(
          and(
            eq(traceSummaries.projectId, input.projectId),
            eq(traceSummaries.traceId, input.traceId),
          ),
        );

      if (existing && existing.status === "running") {
        return { id: existing.id, status: "running" as const };
      }
      if (existing && existing.status === "done" && !input.force) {
        return { id: existing.id, status: "done" as const };
      }

      // Upsert a row in pending/running state
      const [row] = await db
        .insert(traceSummaries)
        .values({
          projectId: input.projectId,
          traceId: input.traceId,
          markdown: "",
          status: "running",
        })
        .onConflictDoUpdate({
          target: [traceSummaries.projectId, traceSummaries.traceId],
          set: {
            status: "running",
            markdown: "",
            errorMessage: null,
            updatedAt: new Date(),
          },
        })
        .returning();

      // Fire and forget — the analysis function updates the row when done
      analyzeTrace(input.projectId, input.traceId).catch(() => {});

      return { id: row.id, status: "running" as const };
    }),
});
