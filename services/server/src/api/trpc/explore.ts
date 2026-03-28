import { z } from "zod";
import { eq, desc, and } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure, projectMemberProcedure, projectViewerProcedure, checkOrgRole } from "../../trpc.js";
import { db } from "../../shared/db/postgres.js";
import { runSandboxedQuery } from "../../shared/lib/sandboxed-query.js";
import { getProjectTimezone } from "../../services/traces/helpers.js";
import { explores, starredCharts, project } from "../../shared/db/schema.js";
import { legendEntrySchema } from "../../services/explore/types.js";
import {
  getGeneration,
  subscribeGeneration,
} from "../../services/explore/generation-manager.js";
import { runGeneration } from "../../services/explore/generation.js";
import { trackExploreMessageSent, trackExploreChartStarred } from "../../shared/lib/telemetry.js";

/** Resolve a project's orgId from its projectId for manual role checks. */
async function getOrgIdForProject(projectId: string): Promise<string> {
  const [p] = await db
    .select({ organizationId: project.organizationId })
    .from(project)
    .where(eq(project.id, projectId));
  if (!p) throw new TRPCError({ code: "NOT_FOUND" });
  return p.organizationId;
}

export const exploresRouter = router({
  list: projectViewerProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ input }) => {
      return db
        .select({
          id: explores.id,
          name: explores.name,
          updatedAt: explores.updatedAt,
        })
        .from(explores)
        .where(eq(explores.projectId, input.projectId))
        .orderBy(desc(explores.updatedAt));
    }),

  get: authedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      const [explore] = await db
        .select()
        .from(explores)
        .where(eq(explores.id, input.id));
      if (!explore) return null;
      const orgId = await getOrgIdForProject(explore.projectId);
      await checkOrgRole(ctx.user.id, orgId, [
        "viewer",
        "member",
        "admin",
        "owner",
      ]);
      return explore;
    }),

  getByTraceId: projectViewerProcedure
    .input(z.object({ projectId: z.string(), traceId: z.string() }))
    .query(async ({ input }) => {
      const [explore] = await db
        .select()
        .from(explores)
        .where(
          and(
            eq(explores.projectId, input.projectId),
            eq(explores.traceId, input.traceId),
          ),
        );
      return explore ?? null;
    }),

  create: projectMemberProcedure
    .input(
      z.object({
        projectId: z.string(),
        name: z.string().min(1).max(255).optional(),
        traceId: z.string().optional(),
        initialMessages: z.array(z.any()).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const [explore] = await db
        .insert(explores)
        .values({
          projectId: input.projectId,
          name: input.name ?? "New chat",
          traceId: input.traceId,
          ...(input.initialMessages ? { messages: input.initialMessages } : {}),
        })
        .returning();
      return explore;
    }),

  delete: authedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const [explore] = await db
        .select({ projectId: explores.projectId })
        .from(explores)
        .where(eq(explores.id, input.id));
      if (!explore) return;
      const orgId = await getOrgIdForProject(explore.projectId);
      await checkOrgRole(ctx.user.id, orgId, [
        "member",
        "admin",
        "owner",
      ]);
      await db.delete(explores).where(eq(explores.id, input.id));
    }),

  rename: authedProcedure
    .input(z.object({ id: z.string(), name: z.string().min(1).max(255) }))
    .mutation(async ({ input, ctx }) => {
      const [explore] = await db
        .select({ projectId: explores.projectId })
        .from(explores)
        .where(eq(explores.id, input.id));
      if (!explore) return;
      const orgId = await getOrgIdForProject(explore.projectId);
      await checkOrgRole(ctx.user.id, orgId, [
        "member",
        "admin",
        "owner",
      ]);
      await db
        .update(explores)
        .set({ name: input.name, updatedAt: new Date() })
        .where(eq(explores.id, input.id));
    }),

  starChart: projectMemberProcedure
    .input(
      z.object({
        exploreId: z.string(),
        projectId: z.string(),
        title: z.string().optional(),
        chartType: z.string().optional(),
        sql: z.string().optional(),
        xKey: z.string().optional(),
        yKeys: z.array(z.string()).optional(),
        legend: z.array(legendEntrySchema).optional(),
        defaultDays: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const [starred] = await db
        .insert(starredCharts)
        .values({
          exploreId: input.exploreId,
          projectId: input.projectId,
          title: input.title,
          chartType: input.chartType,
          sql: input.sql,
          xKey: input.xKey,
          yKeys: input.yKeys,
          legend: input.legend,
          defaultDays: input.defaultDays,
        })
        .returning();
      trackExploreChartStarred();
      return starred;
    }),

  unstarChart: authedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const [chart] = await db
        .select({ projectId: starredCharts.projectId })
        .from(starredCharts)
        .where(eq(starredCharts.id, input.id));
      if (!chart) return;
      const orgId = await getOrgIdForProject(chart.projectId);
      await checkOrgRole(ctx.user.id, orgId, [
        "member",
        "admin",
        "owner",
      ]);
      await db
        .delete(starredCharts)
        .where(eq(starredCharts.id, input.id));
    }),

  listStarred: projectViewerProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ input }) => {
      return db
        .select({
          id: starredCharts.id,
          title: starredCharts.title,
          chartType: starredCharts.chartType,
          sql: starredCharts.sql,
          xKey: starredCharts.xKey,
          yKeys: starredCharts.yKeys,
          legend: starredCharts.legend,
          defaultDays: starredCharts.defaultDays,
          exploreId: starredCharts.exploreId,
          exploreName: explores.name,
        })
        .from(starredCharts)
        .innerJoin(explores, eq(starredCharts.exploreId, explores.id))
        .where(eq(starredCharts.projectId, input.projectId))
        .orderBy(desc(starredCharts.createdAt));
    }),

  isGenerating: projectMemberProcedure
    .input(z.object({ exploreId: z.string(), projectId: z.string() }))
    .query(async ({ input }) => {
      const gen = getGeneration(input.exploreId);
      return { active: !!gen && !gen.done };
    }),

  chat: projectMemberProcedure
    .input(
      z.object({
        exploreId: z.string(),
        projectId: z.string(),
        prompt: z.string().min(1).optional(),
      }),
    )
    .subscription(async function* ({ input, signal }) {
      const abortSignal = signal ?? new AbortController().signal;

      // Verify the explore belongs to the stated project
      const [explore] = await db
        .select({ projectId: explores.projectId })
        .from(explores)
        .where(eq(explores.id, input.exploreId));
      if (!explore || explore.projectId !== input.projectId) {
        return;
      }

      // If a generation is already running for this explore, just attach
      const existing = getGeneration(input.exploreId);
      if (existing && !existing.done) {
        yield* subscribeGeneration(input.exploreId, abortSignal);
        return;
      }

      // No running generation and no prompt → nothing to do
      if (!input.prompt) return;

      // Otherwise kick off a new background generation
      trackExploreMessageSent();
      runGeneration(input.exploreId, input.projectId, input.prompt);

      // Subscribe to its output
      yield* subscribeGeneration(input.exploreId, abortSignal);
    }),

  requery: projectViewerProcedure
    .input(
      z.object({
        projectId: z.string(),
        sql: z.string(),
        /** Lookback window in days. Overrides the chart's defaultDays. Falls back to 30. */
        days: z.number().int().positive().optional(),
      }),
    )
    .query(async ({ input }) => {
      try {
        const tz = await getProjectTimezone(input.projectId);
        // Pass the current UTC time and selected day range so parameterized
        // queries using {now: DateTime} and {days: UInt32} work correctly.
        const now = new Date().toISOString().replace("T", " ").slice(0, 19);
        const days = input.days ?? 30;
        return await runSandboxedQuery(input.projectId, input.sql, "explore", {
          tz,
          now,
          days,
        });
      } catch (err) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: err instanceof Error ? err.message : "Query execution failed",
        });
      }
    }),
});
