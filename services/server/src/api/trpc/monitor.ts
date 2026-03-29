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
import { monitorItems, monitorComments, project } from "../../shared/db/schema.js";
import { enqueueProcess } from "../../services/monitor/jobs.js";
import { runInvestigation } from "../../services/monitor/agent.js";

const statusEnum = z.enum(["queue", "investigating", "review", "done"]);

export const monitorRouter = router({
  list: projectMemberProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ input }) => {
      return db
        .select()
        .from(monitorItems)
        .where(eq(monitorItems.projectId, input.projectId))
        .orderBy(monitorItems.updatedAt);
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

      await enqueueProcess(input.projectId, item.id);

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

  markRead: authedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      await db
        .update(monitorItems)
        .set({ read: true })
        .where(eq(monitorItems.id, input.id));
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

  // ── Comments ────────────────────────────────────────────────────────

  listComments: authedProcedure
    .input(z.object({ monitorItemId: z.string() }))
    .query(async ({ input, ctx }) => {
      // Verify access via the item's project
      const [item] = await db
        .select({ projectId: monitorItems.projectId })
        .from(monitorItems)
        .where(eq(monitorItems.id, input.monitorItemId));
      if (!item) throw new TRPCError({ code: "NOT_FOUND" });

      const [p] = await db
        .select({ organizationId: project.organizationId })
        .from(project)
        .where(eq(project.id, item.projectId));
      if (!p) throw new TRPCError({ code: "NOT_FOUND" });
      await checkOrgRole(ctx.user.id, p.organizationId, [
        "viewer", "member", "admin", "owner",
      ]);

      return db
        .select()
        .from(monitorComments)
        .where(eq(monitorComments.monitorItemId, input.monitorItemId))
        .orderBy(monitorComments.createdAt);
    }),

  addComment: authedProcedure
    .input(
      z.object({
        monitorItemId: z.string(),
        content: z.string().min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const [item] = await db
        .select({ projectId: monitorItems.projectId })
        .from(monitorItems)
        .where(eq(monitorItems.id, input.monitorItemId));
      if (!item) throw new TRPCError({ code: "NOT_FOUND" });

      const [p] = await db
        .select({ organizationId: project.organizationId })
        .from(project)
        .where(eq(project.id, item.projectId));
      if (!p) throw new TRPCError({ code: "NOT_FOUND" });
      await checkOrgRole(ctx.user.id, p.organizationId, [
        "member", "admin", "owner",
      ]);

      const [comment] = await db
        .insert(monitorComments)
        .values({
          monitorItemId: input.monitorItemId,
          source: "user",
          content: input.content,
        })
        .returning();

      // Touch the item's updatedAt
      await db
        .update(monitorItems)
        .set({ updatedAt: new Date() })
        .where(eq(monitorItems.id, input.monitorItemId));

      // Enqueue investigation so the agent can respond to the comment
      await enqueueProcess(item.projectId, input.monitorItemId, true);

      return comment;
    }),

  investigate: authedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const [item] = await db
        .select()
        .from(monitorItems)
        .where(eq(monitorItems.id, input.id));
      if (!item) throw new TRPCError({ code: "NOT_FOUND" });

      const [p] = await db
        .select({ organizationId: project.organizationId })
        .from(project)
        .where(eq(project.id, item.projectId));
      if (!p) throw new TRPCError({ code: "NOT_FOUND" });
      await checkOrgRole(ctx.user.id, p.organizationId, ["member", "admin", "owner"]);

      // Update status and run immediately (don't await — return fast)
      await db
        .update(monitorItems)
        .set({ status: "investigating", updatedAt: new Date() })
        .where(eq(monitorItems.id, input.id));

      // Fire and forget
      runInvestigation({ projectId: item.projectId, itemId: item.id }).catch(() => {});
    }),

  // ── Agent memory ──────────────────────────────────────────────────

  getMemory: projectMemberProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ input }) => {
      const [p] = await db
        .select({ agentMemory: project.agentMemory })
        .from(project)
        .where(eq(project.id, input.projectId));
      return p?.agentMemory ?? "";
    }),

  updateMemory: projectAdminProcedure
    .input(z.object({ projectId: z.string(), content: z.string() }))
    .mutation(async ({ input }) => {
      await db
        .update(project)
        .set({ agentMemory: input.content })
        .where(eq(project.id, input.projectId));
    }),
});
