import { z } from "zod";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, projectAdminProcedure } from "../../trpc.js";
import { db } from "../../shared/db/postgres.js";
import { piiRedactionSettings, piiCustomPatterns } from "../../shared/db/schema.js";
import { invalidateRedactionCache } from "../../services/ingest/pii-settings-cache.js";

const customPatternSchema = z.object({
  id: z.string().uuid().optional(), // present for existing patterns
  label: z.string().min(1).max(64),
  pattern: z.string().min(1).max(512),
  replacement: z.string().min(1).max(64),
  enabled: z.boolean().default(true),
});

const upsertInput = z.object({
  projectId: z.string(),
  email: z.boolean(),
  phone: z.boolean(),
  ssn: z.boolean(),
  creditCard: z.boolean(),
  ipAddress: z.boolean(),
  dateOfBirth: z.boolean(),
  usAddress: z.boolean(),
  apiKey: z.boolean(),
  url: z.boolean(),
  customPatterns: z.array(customPatternSchema),
});

export const piiRedactionRouter = router({
  get: projectAdminProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ input }) => {
      const [settings] = await db
        .select()
        .from(piiRedactionSettings)
        .where(eq(piiRedactionSettings.projectId, input.projectId))
        .limit(1);

      const customs = await db
        .select()
        .from(piiCustomPatterns)
        .where(eq(piiCustomPatterns.projectId, input.projectId));

      return { settings: settings ?? null, customPatterns: customs };
    }),

  upsert: projectAdminProcedure
    .input(upsertInput)
    .mutation(async ({ input }) => {
      // Validate all custom regex patterns compile
      for (const cp of input.customPatterns) {
        try {
          new RegExp(cp.pattern, "g");
        } catch {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Invalid regex pattern for "${cp.label}": ${cp.pattern}`,
          });
        }
      }

      const { customPatterns, ...settingsData } = input;

      // Upsert settings row
      await db
        .insert(piiRedactionSettings)
        .values(settingsData)
        .onConflictDoUpdate({
          target: piiRedactionSettings.projectId,
          set: {
            email: settingsData.email,
            phone: settingsData.phone,
            ssn: settingsData.ssn,
            creditCard: settingsData.creditCard,
            ipAddress: settingsData.ipAddress,
            dateOfBirth: settingsData.dateOfBirth,
            usAddress: settingsData.usAddress,
            apiKey: settingsData.apiKey,
            url: settingsData.url,
            updatedAt: new Date(),
          },
        });

      // Replace custom patterns: delete all, then re-insert
      await db
        .delete(piiCustomPatterns)
        .where(eq(piiCustomPatterns.projectId, input.projectId));

      if (customPatterns.length > 0) {
        await db.insert(piiCustomPatterns).values(
          customPatterns.map((cp) => ({
            projectId: input.projectId,
            label: cp.label,
            pattern: cp.pattern,
            replacement: cp.replacement,
            enabled: cp.enabled,
          })),
        );
      }

      invalidateRedactionCache(input.projectId);

      return { ok: true };
    }),
});
