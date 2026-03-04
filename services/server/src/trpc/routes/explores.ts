import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import type { ModelMessage } from "ai";
import { router, authedProcedure } from "../trpc.js";
import { db } from "../../db/index.js";
import { clickhouse } from "../../db/clickhouse.js";
import { explores, starredCharts } from "../../db/schema.js";
import { requireOrgMember } from "../orgAccess.js";
import { getAiModel } from "../../lib/ai-provider.js";
import { streamChartGeneration } from "../../lib/chart-generator.js";
import { assertSelectOnly } from "../../lib/sql-validation.js";
import {
  legendEntrySchema,
  type ChartSpec,
  type DisplayPart,
  type StreamEvent,
} from "../../lib/explore-types.js";
import {
  getGeneration,
  startGeneration,
  subscribeGeneration,
} from "../../lib/generation-manager.js";

export const exploresRouter = router({
  list: authedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ input, ctx }) => {
      await requireOrgMember(ctx.user.id, ctx.user.role, input.projectId);
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
      await requireOrgMember(ctx.user.id, ctx.user.role, explore.projectId);
      return explore;
    }),

  create: authedProcedure
    .input(
      z.object({
        projectId: z.string(),
        name: z.string().min(1).max(255).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await requireOrgMember(ctx.user.id, ctx.user.role, input.projectId);
      const [explore] = await db
        .insert(explores)
        .values({
          projectId: input.projectId,
          name: input.name ?? "New chat",
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
      await requireOrgMember(ctx.user.id, ctx.user.role, explore.projectId);
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
      await requireOrgMember(ctx.user.id, ctx.user.role, explore.projectId);
      await db
        .update(explores)
        .set({ name: input.name, updatedAt: new Date() })
        .where(eq(explores.id, input.id));
    }),

  starChart: authedProcedure
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
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await requireOrgMember(ctx.user.id, ctx.user.role, input.projectId);
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
        })
        .returning();
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
      await requireOrgMember(ctx.user.id, ctx.user.role, chart.projectId);
      await db
        .delete(starredCharts)
        .where(eq(starredCharts.id, input.id));
    }),

  listStarred: authedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ input, ctx }) => {
      await requireOrgMember(ctx.user.id, ctx.user.role, input.projectId);
      return db
        .select({
          id: starredCharts.id,
          title: starredCharts.title,
          chartType: starredCharts.chartType,
          sql: starredCharts.sql,
          xKey: starredCharts.xKey,
          yKeys: starredCharts.yKeys,
          legend: starredCharts.legend,
          exploreId: starredCharts.exploreId,
          exploreName: explores.name,
        })
        .from(starredCharts)
        .innerJoin(explores, eq(starredCharts.exploreId, explores.id))
        .where(eq(starredCharts.projectId, input.projectId))
        .orderBy(desc(starredCharts.createdAt));
    }),

  // ── Check if a generation is running ────────────────────────────────────────

  isGenerating: authedProcedure
    .input(z.object({ exploreId: z.string(), projectId: z.string() }))
    .query(async ({ input, ctx }) => {
      await requireOrgMember(ctx.user.id, ctx.user.role, input.projectId);
      const gen = getGeneration(input.exploreId);
      return { active: !!gen && !gen.done };
    }),

  // ── Chat subscription ──────────────────────────────────────────────────────
  //
  // The AI generation runs as a background job decoupled from the SSE
  // connection.  The subscription is a thin consumer that replays past
  // events and then tails new ones.  If the client disconnects and
  // reconnects (same exploreId), it picks up where it left off.
  //
  // `prompt` is optional — omit it to reconnect to an existing generation
  // without starting a new one.

  chat: authedProcedure
    .input(
      z.object({
        exploreId: z.string(),
        projectId: z.string(),
        prompt: z.string().min(1).optional(),
      }),
    )
    .subscription(async function* ({ input, ctx, signal }) {
      await requireOrgMember(ctx.user.id, ctx.user.role, input.projectId);

      const abortSignal = signal ?? new AbortController().signal;

      // If a generation is already running for this explore, just attach
      const existing = getGeneration(input.exploreId);
      if (existing && !existing.done) {
        yield* subscribeGeneration(input.exploreId, abortSignal);
        return;
      }

      // No running generation and no prompt → nothing to do
      if (!input.prompt) return;

      // Otherwise kick off a new background generation
      runGeneration(input.exploreId, input.projectId, input.prompt);

      // Subscribe to its output
      yield* subscribeGeneration(input.exploreId, abortSignal);
    }),

  // ── Requery (for starred charts on homepage) ──────────────────────────────

  requery: authedProcedure
    .input(z.object({ projectId: z.string(), sql: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await requireOrgMember(ctx.user.id, ctx.user.role, input.projectId);
      assertSelectOnly(input.sql);
      const result = await clickhouse.query({
        query: input.sql,
        query_params: { projectId: input.projectId },
        format: "JSONEachRow",
      });
      return (await result.json()) as Record<string, unknown>[];
    }),
});

// ── Background generation runner ────────────────────────────────────────────

function runGeneration(
  exploreId: string,
  projectId: string,
  prompt: string,
) {
  const { push, signal } = startGeneration(exploreId);

  // Fire-and-forget — errors are pushed as events
  (async () => {
    try {
      const model = await getAiModel(projectId);

      const [explore] = await db
        .select({ messages: explores.messages, name: explores.name })
        .from(explores)
        .where(eq(explores.id, exploreId));

      const existingParts = (explore?.messages ?? []) as DisplayPart[];

      const aiMessages: ModelMessage[] = [];
      for (const part of existingParts) {
        if (part.type === "user") {
          aiMessages.push({ role: "user", content: part.content });
        } else if (part.type === "text") {
          aiMessages.push({ role: "assistant", content: part.content });
        }
      }
      aiMessages.push({ role: "user", content: prompt });

      const newParts: DisplayPart[] = [{ type: "user", content: prompt }];
      const charts: { spec: ChartSpec; data: Record<string, unknown>[] }[] = [];

      const result = streamChartGeneration({
        model,
        messages: aiMessages,
        projectId,
        abortSignal: signal,
        onChartUpdate: (spec, data) => {
          charts.push({ spec, data });
        },
      });

      let currentText = "";

      for await (const event of result.fullStream) {
        switch (event.type) {
          case "text-delta":
            currentText += event.text;
            push({ type: "text-delta", content: event.text });
            break;

          case "tool-call":
            if (currentText) {
              newParts.push({ type: "text", content: currentText });
              currentText = "";
            }
            push({ type: "tool-call", toolName: event.toolName, args: event.input });
            break;

          case "tool-result":
            if (event.toolName === "display_chart" && charts.length > 0) {
              const latest = charts[charts.length - 1];
              newParts.push({ type: "chart", spec: latest.spec, data: latest.data });
              push({ type: "chart", spec: latest.spec, data: latest.data });
            }
            push({ type: "tool-result", toolName: event.toolName, result: event.output });
            break;

          case "error":
            push({
              type: "error",
              message: event.error instanceof Error ? event.error.message : "Stream error",
            });
            break;
        }
      }

      // Flush remaining text
      if (currentText) {
        newParts.push({ type: "text", content: currentText });
      }

      // Persist
      if (newParts.length > 1) {
        const allParts = [...existingParts, ...newParts];
        const updateData: Record<string, unknown> = {
          messages: allParts,
          updatedAt: new Date(),
        };

        const isFirstMessage = existingParts.length === 0;
        if (isFirstMessage) {
          updateData.name =
            prompt.length > 40 ? prompt.slice(0, 37) + "..." : prompt;
        }

        await db
          .update(explores)
          .set(updateData)
          .where(eq(explores.id, exploreId));

        push({
          type: "done",
          ...(isFirstMessage ? { name: updateData.name as string } : {}),
        });
      } else {
        push({ type: "done" });
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      push({
        type: "error",
        message: err instanceof Error ? err.message : "Generation failed",
      });
    }
  })();
}
