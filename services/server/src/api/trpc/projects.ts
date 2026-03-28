import { z } from "zod";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  router,
  orgMemberProcedure,
  orgAdminProcedure,
  projectViewerProcedure,
  projectAdminProcedure,
  checkOrgRole,
  authedProcedure,
} from "../../trpc.js";
import { db } from "../../shared/db/postgres.js";
import { project } from "../../shared/db/schema.js";
import { clickhouse } from "../../shared/db/clickhouse.js";
import { trackProjectCreated } from "../../shared/lib/telemetry.js";

export const projectsRouter = router({
  list: orgMemberProcedure
    .input(z.object({ organizationId: z.string() }))
    .query(async ({ input }) => {
      return db
        .select()
        .from(project)
        .where(eq(project.organizationId, input.organizationId))
        .orderBy(project.createdAt);
    }),

  get: projectViewerProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ input }) => {
      const [p] = await db
        .select()
        .from(project)
        .where(eq(project.id, input.projectId));
      if (!p) throw new TRPCError({ code: "NOT_FOUND" });
      return p;
    }),

  create: orgAdminProcedure
    .input(
      z.object({
        organizationId: z.string(),
        name: z.string().min(1).max(255),
        timezone: z.string().max(64).default("UTC"),
      }),
    )
    .mutation(async ({ input }) => {
      const baseSlug = input.name
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9-]/g, "");
      const slug = baseSlug
        ? `${baseSlug}-${crypto.randomUUID().slice(0, 8)}`
        : crypto.randomUUID();
      const projectId = crypto.randomUUID();
      const [p] = await db
        .insert(project)
        .values({
          id: projectId,
          organizationId: input.organizationId,
          name: input.name,
          slug,
          timezone: input.timezone,
          createdAt: new Date(),
        })
        .returning();
      void trackProjectCreated();
      return p;
    }),

  rename: projectAdminProcedure
    .input(
      z.object({ projectId: z.string(), name: z.string().min(1).max(255) }),
    )
    .mutation(async ({ input }) => {
      const [p] = await db
        .update(project)
        .set({ name: input.name })
        .where(eq(project.id, input.projectId))
        .returning();
      return p;
    }),

  updateTimezone: projectAdminProcedure
    .input(
      z.object({ projectId: z.string(), timezone: z.string().max(64) }),
    )
    .mutation(async ({ input }) => {
      const [p] = await db
        .update(project)
        .set({ timezone: input.timezone })
        .where(eq(project.id, input.projectId))
        .returning();
      return p;
    }),

  setAutoAnalyze: projectAdminProcedure
    .input(
      z.object({ projectId: z.string(), autoAnalyze: z.boolean() }),
    )
    .mutation(async ({ input }) => {
      const [p] = await db
        .update(project)
        .set({ autoAnalyze: input.autoAnalyze })
        .where(eq(project.id, input.projectId))
        .returning();
      return p;
    }),

  delete: authedProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const [p] = await db
        .select({ organizationId: project.organizationId })
        .from(project)
        .where(eq(project.id, input.projectId));
      if (!p) throw new TRPCError({ code: "NOT_FOUND" });
      await checkOrgRole(ctx.user.id, p.organizationId, ["owner"]);
      await Promise.all([
        db.delete(project).where(eq(project.id, input.projectId)),
        clickhouse.command({
          query:
            "ALTER TABLE breadcrumb.traces DELETE WHERE project_id = {projectId: UUID}",
          query_params: { projectId: input.projectId },
        }),
        clickhouse.command({
          query:
            "ALTER TABLE breadcrumb.spans DELETE WHERE project_id = {projectId: UUID}",
          query_params: { projectId: input.projectId },
        }),
        clickhouse.command({
          query:
            "ALTER TABLE breadcrumb.trace_rollups DELETE WHERE project_id = {projectId: UUID}",
          query_params: { projectId: input.projectId },
        }),
      ]);
    }),
});
