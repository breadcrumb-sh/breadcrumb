import { z } from "zod";
import { eq, and, desc, sql, isNull, or, gt } from "drizzle-orm";
import { router, orgMemberProcedure, orgViewerProcedure } from "../trpc.js";
import { db } from "../../db/index.js";
import { observations, observationFindings, observationViews } from "../../db/schema.js";
import { invalidateObservationsCache } from "../../lib/observations-cache.js";

const IMPACT_ORDER = sql`CASE ${observationFindings.impact} WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END`;

export const observationsRouter = router({
  list: orgViewerProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ input }) => {
      return db
        .select()
        .from(observations)
        .where(eq(observations.projectId, input.projectId))
        .orderBy(observations.createdAt);
    }),

  create: orgMemberProcedure
    .input(
      z.object({
        projectId: z.string(),
        name: z.string().min(1).max(255),
        traceNames: z.array(z.string()).default([]),
        samplingRate: z.number().int().min(1).max(100).default(100),
        traceLimit: z.number().int().min(1).optional(),
        heuristics: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const [row] = await db
        .insert(observations)
        .values({
          projectId: input.projectId,
          name: input.name,
          traceNames: input.traceNames,
          samplingRate: input.samplingRate,
          traceLimit: input.traceLimit ?? null,
          heuristics: input.heuristics ?? null,
          enabled: true,
        })
        .returning();
      invalidateObservationsCache(input.projectId);
      return row;
    }),

  setEnabled: orgMemberProcedure
    .input(z.object({ projectId: z.string(), id: z.string().uuid(), enabled: z.boolean() }))
    .mutation(async ({ input }) => {
      const [row] = await db
        .update(observations)
        .set({ enabled: input.enabled, updatedAt: new Date() })
        .where(
          and(
            eq(observations.id, input.id),
            eq(observations.projectId, input.projectId),
          ),
        )
        .returning();
      invalidateObservationsCache(input.projectId);
      return row;
    }),

  delete: orgMemberProcedure
    .input(z.object({ projectId: z.string(), id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      await db
        .delete(observations)
        .where(
          and(
            eq(observations.id, input.id),
            eq(observations.projectId, input.projectId),
          ),
        );
      invalidateObservationsCache(input.projectId);
    }),

  // ── Findings ──────────────────────────────────────────────────────────────

  "findings.listAll": orgViewerProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ input }) => {
      return db
        .select({
          id: observationFindings.id,
          observationId: observationFindings.observationId,
          observationName: observations.name,
          referenceTraceId: observationFindings.referenceTraceId,
          impact: observationFindings.impact,
          title: observationFindings.title,
          description: observationFindings.description,
          suggestion: observationFindings.suggestion,
          dismissed: observationFindings.dismissed,
          createdAt: observationFindings.createdAt,
        })
        .from(observationFindings)
        .leftJoin(observations, eq(observationFindings.observationId, observations.id))
        .where(
          and(
            eq(observationFindings.projectId, input.projectId),
            eq(observationFindings.dismissed, false),
          ),
        )
        .orderBy(IMPACT_ORDER, desc(observationFindings.createdAt));
    }),

  "findings.listByTrace": orgViewerProcedure
    .input(z.object({ projectId: z.string(), traceId: z.string() }))
    .query(async ({ input }) => {
      return db
        .select({
          id: observationFindings.id,
          observationId: observationFindings.observationId,
          observationName: observations.name,
          referenceTraceId: observationFindings.referenceTraceId,
          impact: observationFindings.impact,
          title: observationFindings.title,
          description: observationFindings.description,
          suggestion: observationFindings.suggestion,
          dismissed: observationFindings.dismissed,
          createdAt: observationFindings.createdAt,
        })
        .from(observationFindings)
        .leftJoin(observations, eq(observationFindings.observationId, observations.id))
        .where(
          and(
            eq(observationFindings.projectId, input.projectId),
            eq(observationFindings.referenceTraceId, input.traceId),
            eq(observationFindings.dismissed, false),
          ),
        )
        .orderBy(IMPACT_ORDER, desc(observationFindings.createdAt));
    }),

  "findings.list": orgViewerProcedure
    .input(z.object({ projectId: z.string(), observationId: z.string().uuid() }))
    .query(async ({ input }) => {
      return db
        .select()
        .from(observationFindings)
        .where(
          and(
            eq(observationFindings.projectId, input.projectId),
            eq(observationFindings.observationId, input.observationId),
          ),
        )
        .orderBy(desc(observationFindings.createdAt));
    }),

  "findings.dismiss": orgMemberProcedure
    .input(z.object({ projectId: z.string(), id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const [row] = await db
        .update(observationFindings)
        .set({ dismissed: true, updatedAt: new Date() })
        .where(
          and(
            eq(observationFindings.id, input.id),
            eq(observationFindings.projectId, input.projectId),
          ),
        )
        .returning();
      return row;
    }),

  // ── Views / unread ────────────────────────────────────────────────────────

  markViewed: orgMemberProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await db
        .insert(observationViews)
        .values({ userId: ctx.user.id, projectId: input.projectId, lastViewedAt: new Date() })
        .onConflictDoUpdate({
          target: [observationViews.userId, observationViews.projectId],
          set: { lastViewedAt: new Date() },
        });
    }),

  unreadCount: orgViewerProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ input, ctx }) => {
      if (!ctx.user) return 0;

      const [view] = await db
        .select()
        .from(observationViews)
        .where(
          and(
            eq(observationViews.userId, ctx.user.id),
            eq(observationViews.projectId, input.projectId),
          ),
        );

      const since = view?.lastViewedAt ?? new Date(0);

      const [result] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(observationFindings)
        .where(
          and(
            eq(observationFindings.projectId, input.projectId),
            eq(observationFindings.dismissed, false),
            gt(observationFindings.updatedAt, since),
          ),
        );

      return result?.count ?? 0;
    }),

  "findings.listNew": orgViewerProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ input, ctx }) => {
      if (!ctx.user) return [];

      const [view] = await db
        .select()
        .from(observationViews)
        .where(
          and(
            eq(observationViews.userId, ctx.user.id),
            eq(observationViews.projectId, input.projectId),
          ),
        );

      const since = view?.lastViewedAt ?? new Date(0);

      return db
        .select({
          id: observationFindings.id,
          observationName: observations.name,
          impact: observationFindings.impact,
          title: observationFindings.title,
          description: observationFindings.description,
          updatedAt: observationFindings.updatedAt,
        })
        .from(observationFindings)
        .leftJoin(observations, eq(observationFindings.observationId, observations.id))
        .where(
          and(
            eq(observationFindings.projectId, input.projectId),
            eq(observationFindings.dismissed, false),
            gt(observationFindings.updatedAt, since),
          ),
        )
        .orderBy(IMPACT_ORDER, desc(observationFindings.updatedAt))
        .limit(3);
    }),

  // ── Queue stats ───────────────────────────────────────────────────────────

  queueStats: orgViewerProcedure
    .input(z.object({ projectId: z.string(), observationId: z.string().uuid().optional() }))
    .query(async ({ input }) => {
      const rows = input.observationId
        ? await db.execute<{ state: string; count: string }>(sql`
            SELECT state, COUNT(*)::text AS count
            FROM pgboss.job
            WHERE name = 'evaluate-observation'
              AND data->>'projectId' = ${input.projectId}
              AND data->>'observationId' = ${input.observationId}
            GROUP BY state
          `)
        : await db.execute<{ state: string; count: string }>(sql`
            SELECT state, COUNT(*)::text AS count
            FROM pgboss.job
            WHERE name = 'evaluate-observation'
              AND data->>'projectId' = ${input.projectId}
            GROUP BY state
          `);

      const stats = { queued: 0, active: 0, completed: 0 };
      for (const row of rows) {
        const n = Number(row.count);
        if (row.state === "created" || row.state === "retry") stats.queued += n;
        else if (row.state === "active") stats.active += n;
        else if (row.state === "completed") stats.completed += n;
      }
      return stats;
    }),
});
