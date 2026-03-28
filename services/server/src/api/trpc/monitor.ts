import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  router,
  authedProcedure,
  projectMemberProcedure,
  projectAdminProcedure,
  checkOrgRole,
} from "../../trpc.js";
import { db } from "../../shared/db/postgres.js";
import { monitorItems, project } from "../../shared/db/schema.js";

const statusEnum = z.enum(["queue", "investigating", "review", "done"]);

export const monitorRouter = router({
  list: projectMemberProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ input }) => {
      return db
        .select()
        .from(monitorItems)
        .where(eq(monitorItems.projectId, input.projectId))
        .orderBy(monitorItems.createdAt);
    }),

  create: projectMemberProcedure
    .input(
      z.object({
        projectId: z.string(),
        title: z.string().min(1),
        description: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const [item] = await db
        .insert(monitorItems)
        .values({
          projectId: input.projectId,
          title: input.title,
          ...(input.description ? { description: input.description } : {}),
        })
        .returning();
      return item;
    }),

  update: authedProcedure
    .input(
      z.object({
        id: z.string(),
        title: z.string().min(1).optional(),
        description: z.string().optional(),
        status: statusEnum.optional(),
        dismissed: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const [item] = await db
        .select({ projectId: monitorItems.projectId })
        .from(monitorItems)
        .where(eq(monitorItems.id, input.id));
      if (!item) throw new TRPCError({ code: "NOT_FOUND" });

      const [p] = await db
        .select({ organizationId: project.organizationId })
        .from(project)
        .where(eq(project.id, item.projectId));
      if (!p) throw new TRPCError({ code: "NOT_FOUND" });
      await checkOrgRole(ctx.user.id, p.organizationId, [
        "member",
        "admin",
        "owner",
      ]);

      const { id, ...updates } = input;
      const [updated] = await db
        .update(monitorItems)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(monitorItems.id, id))
        .returning();
      return updated;
    }),

  delete: authedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const [item] = await db
        .select({ projectId: monitorItems.projectId })
        .from(monitorItems)
        .where(eq(monitorItems.id, input.id));
      if (!item) throw new TRPCError({ code: "NOT_FOUND" });

      const [p] = await db
        .select({ organizationId: project.organizationId })
        .from(project)
        .where(eq(project.id, item.projectId));
      if (!p) throw new TRPCError({ code: "NOT_FOUND" });
      await checkOrgRole(ctx.user.id, p.organizationId, [
        "admin",
        "owner",
      ]);

      await db.delete(monitorItems).where(eq(monitorItems.id, input.id));
    }),
});
