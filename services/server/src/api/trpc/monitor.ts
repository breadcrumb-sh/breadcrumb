import { on } from "events";
import { z } from "zod";
import { eq, and, gte, sql, desc, inArray } from "drizzle-orm";
import { tracked } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import {
  router,
  authedProcedure,
  projectMemberProcedure,
  projectViewerProcedure,
  projectAdminProcedure,
  checkOrgRole,
} from "../../trpc.js";
import { db } from "../../shared/db/postgres.js";
import { monitorItems, monitorComments, monitorActivity, monitorLabels, monitorItemLabels, monitorScanRuns, project, agentUsage, user } from "../../shared/db/schema.js";
import { readonlyClickhouse } from "../../shared/db/clickhouse.js";
import { trackMonitorItemCreated, trackMonitorItemStatusChanged, trackMonitorUserComment, trackMonitorInvestigationTriggered } from "../../shared/lib/telemetry.js";
import { enqueueProcess, forceEnqueueScan } from "../../services/monitor/jobs.js";
import { enqueueWebhooks } from "../../services/monitor/webhooks.js";
import { runInvestigation } from "../../services/monitor/agent.js";
import { monitorEvents, emitMonitorEvent, type MonitorEvent } from "../../services/monitor/events.js";
import { recordActivity } from "../../services/monitor/activity.js";

const statusEnum = z.enum(["queue", "investigating", "review", "done"]);

export const monitorRouter = router({
  list: projectViewerProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ input }) => {
      const rows = await db
        .select({
          item: monitorItems,
          createdByName: user.name,
        })
        .from(monitorItems)
        .leftJoin(user, eq(monitorItems.createdById, user.id))
        .where(eq(monitorItems.projectId, input.projectId))
        .orderBy(desc(monitorItems.updatedAt));

      // Batch-fetch all item-label associations for this project
      const itemIds = rows.map((r) => r.item.id);
      const labelRows = itemIds.length > 0
        ? await db
            .select({
              itemId: monitorItemLabels.monitorItemId,
              label: monitorLabels,
            })
            .from(monitorItemLabels)
            .innerJoin(monitorLabels, eq(monitorItemLabels.monitorLabelId, monitorLabels.id))
            .where(inArray(monitorItemLabels.monitorItemId, itemIds))
        : [];

      const labelsByItem = new Map<string, Array<{ id: string; name: string; color: string }>>();
      for (const r of labelRows) {
        const arr = labelsByItem.get(r.itemId) ?? [];
        arr.push({ id: r.label.id, name: r.label.name, color: r.label.color });
        labelsByItem.set(r.itemId, arr);
      }

      return rows.map((r) => ({
        ...r.item,
        createdByName: r.createdByName,
        labels: labelsByItem.get(r.item.id) ?? [],
      }));
    }),

  summary: projectViewerProcedure
    .input(z.object({
      projectId: z.string(),
      from: z.string(), // YYYY-MM-DD
      to: z.string(),
    }))
    .query(async ({ input }) => {
      const since = new Date(input.from);

      // Last scan run
      const [lastRun] = await db
        .select()
        .from(monitorScanRuns)
        .where(eq(monitorScanRuns.projectId, input.projectId))
        .orderBy(desc(monitorScanRuns.startedAt))
        .limit(1);

      // Postgres counts
      const items = await db
        .select()
        .from(monitorItems)
        .where(eq(monitorItems.projectId, input.projectId));

      const issuesFound = items.filter(
        (i) => i.source === "agent" && i.createdAt >= since,
      ).length;
      const needsReview = items.filter((i) => i.status === "review").length;
      const resolved = items.filter(
        (i) => i.status === "done" && i.updatedAt >= since,
      ).length;

      // ClickHouse trace count
      const result = await readonlyClickhouse.query({
        query: `
          SELECT count() AS cnt
          FROM (
            SELECT id
            FROM breadcrumb.traces
            WHERE project_id = {projectId: UUID}
              AND start_time >= {from: Date}
              AND start_time < {to: Date} + INTERVAL 1 DAY
            GROUP BY id
          )
        `,
        query_params: { projectId: input.projectId, from: input.from, to: input.to },
        format: "JSONEachRow",
      });
      const rows = (await result.json()) as Array<{ cnt: string }>;
      const traceCount = Number(rows[0]?.cnt ?? 0);

      return {
        issuesFound,
        needsReview,
        resolved,
        traceCount,
        lastRun: lastRun ? {
          status: lastRun.status as "running" | "success" | "empty" | "skipped" | "error",
          ticketsCreated: lastRun.ticketsCreated,
          costCents: lastRun.costCents,
          errorMessage: lastRun.errorMessage,
          startedAt: lastRun.startedAt.toISOString(),
          finishedAt: lastRun.finishedAt?.toISOString() ?? null,
        } : null,
      };
    }),

  triggerScan: projectMemberProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(async ({ input }) => {
      await forceEnqueueScan(input.projectId);
    }),

  scanRuns: projectViewerProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ input }) => {
      const runs = await db
        .select()
        .from(monitorScanRuns)
        .where(eq(monitorScanRuns.projectId, input.projectId))
        .orderBy(desc(monitorScanRuns.startedAt))
        .limit(50);

      return runs.map((r) => ({
        id: r.id,
        status: r.status as "running" | "success" | "empty" | "skipped" | "error",
        ticketsCreated: r.ticketsCreated,
        costCents: r.costCents,
        errorMessage: r.errorMessage,
        startedAt: r.startedAt.toISOString(),
        finishedAt: r.finishedAt?.toISOString() ?? null,
      }));
    }),

  create: projectMemberProcedure
    .input(
      z.object({
        projectId: z.string(),
        title: z.string().min(1),
        description: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const [item] = await db
        .insert(monitorItems)
        .values({
          projectId: input.projectId,
          title: input.title,
          createdById: ctx.user.id,
          ...(input.description ? { description: input.description } : {}),
        })
        .returning();

      await recordActivity(item.id, "created", "user", { actorId: ctx.user.id });
      await enqueueProcess(input.projectId, item.id);
      trackMonitorItemCreated();

      return item;
    }),

  update: authedProcedure
    .input(
      z.object({
        id: z.string(),
        title: z.string().min(1).optional(),
        description: z.string().optional(),
        status: statusEnum.optional(),
        priority: z.enum(["none", "low", "medium", "high", "critical"]).optional(),
        traceNames: z.array(z.string()).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const [item] = await db
        .select({ projectId: monitorItems.projectId, status: monitorItems.status })
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
        .set({ ...updates, ...(updates.status === "done" ? { read: true } : {}), updatedAt: new Date() })
        .where(eq(monitorItems.id, id))
        .returning();

      if (updates.status && updates.status !== item.status) {
        trackMonitorItemStatusChanged(item.status, updates.status);
        await recordActivity(id, "status_change", "user", { fromStatus: item.status, toStatus: updates.status, actorId: ctx.user.id });
        if (updates.status === "queue") {
          await enqueueProcess(item.projectId, id);
        }
        if (updates.status === "review") {
          await enqueueWebhooks(item.projectId, id);
        }
      }
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

  // ── Activity ────────────────────────────────────────────────────────

  listActivity: authedProcedure
    .input(z.object({ monitorItemId: z.string() }))
    .query(async ({ input, ctx }) => {
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

      const rows = await db
        .select({
          activity: monitorActivity,
          actorName: user.name,
        })
        .from(monitorActivity)
        .leftJoin(user, eq(monitorActivity.actorId, user.id))
        .where(eq(monitorActivity.monitorItemId, input.monitorItemId))
        .orderBy(monitorActivity.createdAt);
      return rows.map((r) => ({ ...r.activity, actorName: r.actorName }));
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

      const rows = await db
        .select({
          comment: monitorComments,
          authorName: user.name,
        })
        .from(monitorComments)
        .leftJoin(user, eq(monitorComments.authorId, user.id))
        .where(eq(monitorComments.monitorItemId, input.monitorItemId))
        .orderBy(monitorComments.createdAt);
      return rows.map((r) => ({ ...r.comment, authorName: r.authorName }));
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
          authorId: ctx.user.id,
          content: input.content,
        })
        .returning();

      // Touch the item's updatedAt
      await db
        .update(monitorItems)
        .set({ updatedAt: new Date() })
        .where(eq(monitorItems.id, input.monitorItemId));

      emitMonitorEvent({ projectId: item.projectId, itemId: input.monitorItemId, type: "comment" });

      // Enqueue investigation so the agent can respond to the comment
      await enqueueProcess(item.projectId, input.monitorItemId, true);
      trackMonitorUserComment();

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
      const oldStatus = item.status;
      await db
        .update(monitorItems)
        .set({ status: "investigating", updatedAt: new Date() })
        .where(eq(monitorItems.id, input.id));

      if (oldStatus !== "investigating") {
        await recordActivity(input.id, "status_change", "user", { fromStatus: oldStatus, toStatus: "investigating", actorId: ctx.user.id });
      }

      // Fire and forget
      runInvestigation({ projectId: item.projectId, itemId: item.id }).catch(() => {});
      trackMonitorInvestigationTriggered();
    }),

  // ── Agent memory ──────────────────────────────────────────────────

  getMemory: projectViewerProcedure
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

  // ── Limits ────────────────────────────────────────────────────────

  getLimits: projectViewerProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ input }) => {
      const [p] = await db
        .select({
          monthlyCostLimitCents: project.agentMonthlyCostLimitCents,
          scanIntervalSeconds: project.agentScanIntervalSeconds,
        })
        .from(project)
        .where(eq(project.id, input.projectId));

      const month = new Date().toISOString().slice(0, 7);
      const [usage] = await db
        .select()
        .from(agentUsage)
        .where(and(eq(agentUsage.projectId, input.projectId), eq(agentUsage.month, month)));

      return {
        monthlyCostLimitCents: p?.monthlyCostLimitCents ?? 1000,
        scanIntervalSeconds: p?.scanIntervalSeconds ?? 300,
        monthUsage: {
          inputTokens: usage?.inputTokens ?? 0,
          outputTokens: usage?.outputTokens ?? 0,
          costCents: usage?.costCents ?? 0,
          calls: usage?.calls ?? 0,
        },
      };
    }),

  updateLimits: projectAdminProcedure
    .input(z.object({
      projectId: z.string(),
      monthlyCostLimitCents: z.number().min(0),
      scanIntervalSeconds: z.number().min(60).max(86400),
    }))
    .mutation(async ({ input }) => {
      await db
        .update(project)
        .set({
          agentMonthlyCostLimitCents: input.monthlyCostLimitCents,
          agentScanIntervalSeconds: input.scanIntervalSeconds,
        })
        .where(eq(project.id, input.projectId));
    }),

  // ── SSE subscription ──────────────────────────────────────────────

  onEvent: projectViewerProcedure
    .input(z.object({ projectId: z.string() }))
    .subscription(async function* (opts) {
      const { projectId } = opts.input;
      for await (const [event] of on(monitorEvents, `project:${projectId}`, {
        signal: opts.signal,
      })) {
        const e = event as MonitorEvent;
        yield tracked(e.itemId || `scan-${Date.now()}`, e);
      }
    }),
});
