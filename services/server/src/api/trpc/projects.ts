import { z } from "zod";
import { eq, inArray, and } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, procedure, authedProcedure, adminProcedure, checkOrgRole } from "../../trpc.js";
import { db } from "../../shared/db/postgres.js";
import { organization, member } from "../../shared/db/schema.js";
import { clickhouse } from "../../shared/db/clickhouse.js";
import { env } from "../../env.js";
import { trackProjectCreated } from "../../shared/lib/telemetry.js";

export const projectsRouter = router({
  list: procedure.query(async ({ ctx }) => {
    // Public viewing: return all orgs
    if (!ctx.user) {
      if (!env.allowPublicViewing) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }
      return db.select().from(organization).orderBy(organization.createdAt);
    }
    if (ctx.user.role === "admin") {
      return db.select().from(organization).orderBy(organization.createdAt);
    }
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

  get: procedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      const [org] = await db
        .select()
        .from(organization)
        .where(eq(organization.id, input.id));
      if (!org) return null;
      // Public viewing: return org without membership check
      if (!ctx.user) {
        if (!env.allowPublicViewing) {
          throw new TRPCError({ code: "UNAUTHORIZED" });
        }
        return org;
      }
      if (ctx.user.role === "admin") return org;
      const [m] = await db
        .select()
        .from(member)
        .where(
          and(
            eq(member.organizationId, input.id),
            eq(member.userId, ctx.user.id)
          )
        );
      return m ? org : null;
    }),

  create: adminProcedure
    .input(z.object({
      name: z.string().min(1).max(255),
      timezone: z.string().max(64).default("UTC"),
    }))
    .mutation(async ({ input, ctx }) => {
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
          timezone: input.timezone,
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
      void trackProjectCreated();
      return org;
    }),

  rename: authedProcedure
    .input(
      z.object({ id: z.string(), name: z.string().min(1).max(255) })
    )
    .mutation(async ({ input, ctx }) => {
      await checkOrgRole(ctx.user.id, ctx.user.role, input.id, ["owner"]);
      const [org] = await db
        .update(organization)
        .set({ name: input.name })
        .where(eq(organization.id, input.id))
        .returning();
      return org;
    }),

  updateTimezone: authedProcedure
    .input(
      z.object({ id: z.string(), timezone: z.string().max(64) })
    )
    .mutation(async ({ input, ctx }) => {
      await checkOrgRole(ctx.user.id, ctx.user.role, input.id, ["owner"]);
      const [org] = await db
        .update(organization)
        .set({ timezone: input.timezone })
        .where(eq(organization.id, input.id))
        .returning();
      return org;
    }),

  setAutoAnalyze: authedProcedure
    .input(
      z.object({ id: z.string(), autoAnalyze: z.boolean() })
    )
    .mutation(async ({ input, ctx }) => {
      await checkOrgRole(ctx.user.id, ctx.user.role, input.id, ["admin", "owner"]);
      const [org] = await db
        .update(organization)
        .set({ autoAnalyze: input.autoAnalyze })
        .where(eq(organization.id, input.id))
        .returning();
      return org;
    }),

  delete: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      await Promise.all([
        db.delete(organization).where(eq(organization.id, input.id)),
        clickhouse.command({
          query:
            "ALTER TABLE breadcrumb.traces DELETE WHERE project_id = {projectId: UUID}",
          query_params: { projectId: input.id },
        }),
        clickhouse.command({
          query:
            "ALTER TABLE breadcrumb.spans DELETE WHERE project_id = {projectId: UUID}",
          query_params: { projectId: input.id },
        }),
        clickhouse.command({
          query:
            "ALTER TABLE breadcrumb.trace_rollups DELETE WHERE project_id = {projectId: UUID}",
          query_params: { projectId: input.id },
        }),
      ]);
    }),
});
