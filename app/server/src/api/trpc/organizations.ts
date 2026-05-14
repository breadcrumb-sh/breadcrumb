import { z } from "zod";
import { eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure, orgAdminProcedure, checkOrgRole } from "../../trpc.js";
import { env } from "../../env.js";
import { db } from "../../shared/db/postgres.js";
import { organization, member, project } from "../../shared/db/schema.js";
import { clickhouse } from "../../shared/db/clickhouse.js";

export const organizationsRouter = router({
  list: authedProcedure.query(async ({ ctx }) => {
    const memberRows = await db
      .select({ organizationId: member.organizationId })
      .from(member)
      .where(eq(member.userId, ctx.user.id));
    const orgIds = memberRows.map((m) => m.organizationId);
    if (!orgIds.length) return [];
    return db
      .select()
      .from(organization)
      .where(inArray(organization.id, orgIds))
      .orderBy(organization.createdAt);
  }),

  get: authedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      const [org] = await db
        .select()
        .from(organization)
        .where(eq(organization.id, input.id));
      if (!org) return null;
      await checkOrgRole(ctx.user.id, input.id, [
        "viewer",
        "member",
        "admin",
        "owner",
      ]);
      return org;
    }),

  create: authedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(255),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (!env.allowOrgCreation) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Organization creation is disabled" });
      }
      const baseSlug = input.name
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9-]/g, "");
      const slug = baseSlug
        ? `${baseSlug}-${crypto.randomUUID().slice(0, 8)}`
        : crypto.randomUUID();
      const orgId = crypto.randomUUID();
      const [org] = await db
        .insert(organization)
        .values({
          id: orgId,
          name: input.name,
          slug,
          createdAt: new Date(),
        })
        .returning();
      await db.insert(member).values({
        id: crypto.randomUUID(),
        organizationId: orgId,
        userId: ctx.user.id,
        role: "owner",
        createdAt: new Date(),
      });
      return org;
    }),

  update: orgAdminProcedure
    .input(
      z.object({
        organizationId: z.string(),
        name: z.string().min(1).max(255),
      }),
    )
    .mutation(async ({ input }) => {
      const [org] = await db
        .update(organization)
        .set({ name: input.name })
        .where(eq(organization.id, input.organizationId))
        .returning();
      return org;
    }),

  delete: authedProcedure
    .input(z.object({ organizationId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await checkOrgRole(ctx.user.id, input.organizationId, ["owner"]);
      // Get all project IDs in this org for ClickHouse cleanup
      const projects = await db
        .select({ id: project.id })
        .from(project)
        .where(eq(project.organizationId, input.organizationId));
      const projectIds = projects.map((p) => p.id);

      // Delete org (cascades to projects, members, invitations, and all project data)
      await db.delete(organization).where(eq(organization.id, input.organizationId));

      // Clean up ClickHouse data for all projects
      for (const pid of projectIds) {
        await Promise.all([
          clickhouse.command({
            query:
              "ALTER TABLE breadcrumb.traces DELETE WHERE project_id = {projectId: UUID}",
            query_params: { projectId: pid },
          }),
          clickhouse.command({
            query:
              "ALTER TABLE breadcrumb.spans DELETE WHERE project_id = {projectId: UUID}",
            query_params: { projectId: pid },
          }),
          clickhouse.command({
            query:
              "ALTER TABLE breadcrumb.trace_rollups DELETE WHERE project_id = {projectId: UUID}",
            query_params: { projectId: pid },
          }),
        ]);
      }
    }),
});
