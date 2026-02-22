import { z } from "zod";
import { eq, inArray, and } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure, adminProcedure } from "../trpc.js";
import { db } from "../../db/index.js";
import { organization, member } from "../../db/schema.js";
import { clickhouse } from "../../db/clickhouse.js";

export const projectsRouter = router({
  list: authedProcedure.query(async ({ ctx }) => {
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

  get: authedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      const [org] = await db
        .select()
        .from(organization)
        .where(eq(organization.id, input.id));
      if (!org) return null;
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
    .input(z.object({ name: z.string().min(1).max(255) }))
    .mutation(async ({ input, ctx }) => {
      const slug = input.name
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9-]/g, "");
      const orgId = crypto.randomUUID();
      const [org] = await db
        .insert(organization)
        .values({
          id: orgId,
          name: input.name,
          slug: slug || crypto.randomUUID(),
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

  rename: authedProcedure
    .input(
      z.object({ id: z.string(), name: z.string().min(1).max(255) })
    )
    .mutation(async ({ input, ctx }) => {
      if (ctx.user.role !== "admin") {
        const [m] = await db
          .select()
          .from(member)
          .where(
            and(
              eq(member.organizationId, input.id),
              eq(member.userId, ctx.user.id)
            )
          );
        if (!m || m.role !== "owner") {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
      }
      const [org] = await db
        .update(organization)
        .set({ name: input.name })
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
