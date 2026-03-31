/**
 * Duplicate ticket detection — checks proposed tickets against existing ones
 * using structured LLM output to decide if a duplicate exists.
 */

import { generateObject, type LanguageModel } from "ai";
import { and, eq, gte, or, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../shared/db/postgres.js";
import { monitorItems } from "../../shared/db/schema.js";
import { createLogger } from "../../shared/lib/logger.js";

const log = createLogger("monitor-dedup");

const CLOSED_WINDOW_DAYS = 14;
const DESC_CUTOFF = 200;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "…";
}

const dedupSchema = z.object({
  isDuplicate: z
    .boolean()
    .describe("Is the proposed ticket about the same underlying issue as an existing one?"),
  existingTicketId: z
    .string()
    .nullable()
    .describe("ID of the matching existing ticket, if duplicate"),
  confidence: z
    .enum(["high", "medium", "low"])
    .describe("How confident are you in this judgment?"),
  reason: z
    .string()
    .describe("Brief explanation of why this is or isn't a duplicate"),
});

export interface DedupResult {
  blocked: boolean;
  message: string;
}

export async function checkDuplicate(
  projectId: string,
  title: string,
  description: string,
  model: LanguageModel,
): Promise<DedupResult> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - CLOSED_WINDOW_DAYS);

  const existing = await db
    .select({
      id: monitorItems.id,
      title: monitorItems.title,
      description: monitorItems.description,
      status: monitorItems.status,
    })
    .from(monitorItems)
    .where(
      and(
        eq(monitorItems.projectId, projectId),
        or(
          // All open tickets
          ne(monitorItems.status, "done"),
          // Closed tickets within window
          and(eq(monitorItems.status, "done"), gte(monitorItems.updatedAt, cutoff)),
        ),
      ),
    );

  if (existing.length === 0) {
    return { blocked: false, message: "" };
  }

  const ticketList = existing
    .map(
      (t) =>
        `- [${t.id}] (${t.status}) ${t.title}\n  ${truncate(t.description, DESC_CUTOFF)}`,
    )
    .join("\n");

  try {
    const { object } = await generateObject({
      model,
      temperature: 0,
      schema: dedupSchema,
      prompt: `You are checking whether a proposed monitoring ticket is a duplicate of an existing one.

## Proposed Ticket
**Title:** ${title}
**Description:** ${truncate(description, DESC_CUTOFF)}

## Existing Tickets
${ticketList}

A ticket is a duplicate if it describes the same underlying issue, even if worded differently. Different symptoms of the same root cause count as duplicates. Tickets about different issues affecting the same service are NOT duplicates.`,
    });

    if (object.isDuplicate && (object.confidence === "high" || object.confidence === "medium")) {
      const matchTitle = existing.find((t) => t.id === object.existingTicketId)?.title ?? "unknown";
      const msg = `Duplicate detected (${object.confidence} confidence): matches existing ticket "${matchTitle}" [${object.existingTicketId}]. ${object.reason}`;
      log.info({ projectId, title, existingId: object.existingTicketId, confidence: object.confidence }, "duplicate blocked");
      return { blocked: true, message: msg };
    }

    return { blocked: false, message: "" };
  } catch (err) {
    // If dedup check fails, allow creation — better a duplicate than a missed issue
    log.warn({ projectId, title, err }, "dedup check failed, allowing creation");
    return { blocked: false, message: "" };
  }
}
