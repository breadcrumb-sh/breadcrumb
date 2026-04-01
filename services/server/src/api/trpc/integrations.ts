import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  router,
  projectAdminProcedure,
} from "../../trpc.js";
import { db } from "../../shared/db/postgres.js";
import { webhookIntegrations } from "../../shared/db/schema.js";
import { sendTestWebhook } from "../../services/monitor/webhooks.js";

const channelSchema = z.enum(["slack", "discord"]);
const minPrioritySchema = z.enum(["all", "low", "medium", "high", "critical"]);

export const integrationsRouter = router({
  list: projectAdminProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ input }) => {
      return db
        .select()
        .from(webhookIntegrations)
        .where(eq(webhookIntegrations.projectId, input.projectId));
    }),

  upsert: projectAdminProcedure
    .input(
      z.object({
        projectId: z.string(),
        channel: channelSchema,
        url: z.string().url(),
        minPriority: minPrioritySchema.default("all"),
        enabled: z.boolean().default(false),
      }),
    )
    .mutation(async ({ input }) => {
      const [row] = await db
        .insert(webhookIntegrations)
        .values({
          projectId: input.projectId,
          channel: input.channel,
          url: input.url,
          minPriority: input.minPriority,
          enabled: input.enabled,
        })
        .onConflictDoUpdate({
          target: [webhookIntegrations.projectId, webhookIntegrations.channel],
          set: {
            url: input.url,
            minPriority: input.minPriority,
            enabled: input.enabled,
            updatedAt: new Date(),
          },
        })
        .returning();
      return row;
    }),

  delete: projectAdminProcedure
    .input(z.object({ projectId: z.string(), channel: channelSchema }))
    .mutation(async ({ input }) => {
      await db
        .delete(webhookIntegrations)
        .where(
          and(
            eq(webhookIntegrations.projectId, input.projectId),
            eq(webhookIntegrations.channel, input.channel),
          ),
        );
    }),

  test: projectAdminProcedure
    .input(z.object({ projectId: z.string(), channel: channelSchema, url: z.string().url() }))
    .mutation(async ({ input }) => {
      try {
        await sendTestWebhook(input.channel, input.url, input.projectId);
      } catch (err) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: err instanceof Error ? err.message : "Webhook delivery failed",
        });
      }
    }),
});
