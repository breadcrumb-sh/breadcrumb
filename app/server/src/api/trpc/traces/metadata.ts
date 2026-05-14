import { z } from "zod";
import { router, projectViewerProcedure } from "../../../trpc.js";
import { readonlyClickhouse } from "../../../shared/db/clickhouse.js";
import { getProjectTimezone } from "../../../services/traces/helpers.js";

export const metadataRouter = router({
  environments: projectViewerProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ input }) => {
      const result = await readonlyClickhouse.query({
        query: `
          SELECT DISTINCT env
          FROM (
            SELECT argMax(environment, version) AS env
            FROM breadcrumb.traces
            WHERE project_id = {projectId: UUID}
            GROUP BY id
          )
          WHERE env != ''
          ORDER BY env ASC
        `,
        query_params: { projectId: input.projectId },
        format: "JSONEachRow",
      });

      const rows = (await result.json()) as Array<Record<string, unknown>>;
      return rows.map((r) => String(r["env"]));
    }),

  models: projectViewerProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ input }) => {
      const result = await readonlyClickhouse.query({
        query: `
          SELECT DISTINCT model
          FROM breadcrumb.spans
          WHERE project_id = {projectId: UUID}
            AND model != ''
          ORDER BY model ASC
          LIMIT 100
        `,
        query_params: { projectId: input.projectId },
        format: "JSONEachRow",
      });

      const rows = (await result.json()) as Array<Record<string, unknown>>;
      return rows.map((r) => String(r["model"]));
    }),

  names: projectViewerProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ input }) => {
      const result = await readonlyClickhouse.query({
        query: `
          SELECT DISTINCT name
          FROM (
            SELECT argMax(name, version) AS name
            FROM breadcrumb.traces
            WHERE project_id = {projectId: UUID}
            GROUP BY id
          )
          WHERE name != ''
          ORDER BY name ASC
          LIMIT 500
        `,
        query_params: { projectId: input.projectId },
        format: "JSONEachRow",
      });

      const rows = (await result.json()) as Array<Record<string, unknown>>;
      return rows.map((r) => String(r["name"]));
    }),

  dailyCount: projectViewerProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        days: z.number().int().min(1).max(90).default(30),
      })
    )
    .query(async ({ input }) => {
      const tz = await getProjectTimezone(input.projectId);
      const result = await readonlyClickhouse.query({
        query: `
          SELECT
            toDate(start_time, {tz: String}) AS day,
            count()            AS trace_count
          FROM (
            SELECT id, argMax(start_time, version) AS start_time
            FROM breadcrumb.traces
            WHERE project_id = {projectId: UUID}
            GROUP BY id
          )
          WHERE start_time >= today() - {days: UInt32} + 1
          GROUP BY day
          ORDER BY day ASC
        `,
        query_params: { projectId: input.projectId, days: input.days, tz },
        format: "JSONEachRow",
      });

      const rows = (await result.json()) as Array<Record<string, unknown>>;
      return rows.map((r) => ({ date: String(r["day"]), count: Number(r["trace_count"]) }));
    }),
});
