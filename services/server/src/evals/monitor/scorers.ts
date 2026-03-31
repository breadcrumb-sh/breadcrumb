/**
 * Shared Evalite scorers for monitor agent evals.
 */

import { generateObject } from "ai";
import { z } from "zod";
import { createScorer } from "evalite";
import { evalModel } from "./model.js";
import type { MonitorEvalOutcome, ScanFixture, InvestigateFixture } from "./types.js";

// ── Scan scorers ────────────────────────────────────────────────────────────

export const ticketDecision = createScorer<ScanFixture, MonitorEvalOutcome, ScanFixture["expected"]>({
  name: "Ticket Decision",
  description: "Did the agent correctly decide whether to create tickets?",
  scorer: ({ output, expected }) => {
    if (!expected) return 0;
    const created = output.ticketsCreated.length > 0;
    return created === expected.shouldCreateTickets ? 1 : 0;
  },
});

export const ticketCount = createScorer<ScanFixture, MonitorEvalOutcome, ScanFixture["expected"]>({
  name: "Ticket Count",
  description: "Is the number of tickets within the expected range?",
  scorer: ({ output, expected }) => {
    if (!expected) return 0;
    if (!expected.shouldCreateTickets) {
      return output.ticketsCreated.length === 0 ? 1 : 0;
    }
    const [min, max] = expected.ticketCount ?? [1, 3];
    const count = output.ticketsCreated.length;
    if (count >= min && count <= max) return 1;
    if (count === min - 1 || count === max + 1) return 0.5;
    return 0;
  },
});

export const scanMemoryMaintenance = createScorer<ScanFixture, MonitorEvalOutcome, ScanFixture["expected"]>({
  name: "Memory Maintenance",
  description: "Did the agent update memory when expected?",
  scorer: ({ output, expected }) => {
    if (!expected) return 0;
    const updated = output.memoryWrites.length + output.memoryUpdates.length > 0;
    if (updated === expected.shouldUpdateMemory) return 1;
    if (updated && !expected.shouldUpdateMemory) return 0.5;
    return 0;
  },
});

export const scanQueryEfficiency = createScorer<ScanFixture, MonitorEvalOutcome, ScanFixture["expected"]>({
  name: "Query Efficiency",
  description: "Did the agent use a reasonable number of queries?",
  scorer: ({ output }) => {
    const n = output.queriesRun.length;
    if (n === 0) return 0;
    if (n <= 6) return 1;
    if (n <= 10) return 0.75;
    return 0.5;
  },
});

export const ticketRelevance = createScorer<ScanFixture, MonitorEvalOutcome, ScanFixture["expected"]>({
  name: "Ticket Relevance",
  description: "Do ticket titles contain expected keywords?",
  scorer: ({ output, expected }) => {
    if (!expected) return 0;
    const keywords = expected.ticketTitleKeywords;
    if (!keywords || keywords.length === 0) return 1;
    if (output.ticketsCreated.length === 0) return 0;

    const titles = output.ticketsCreated.map((t) => t.title.toLowerCase()).join(" ");
    const matched = keywords.filter((k) => titles.includes(k.toLowerCase()));
    return matched.length / keywords.length;
  },
});

// ── Investigation scorers ───────────────────────────────────────────────────

type InvestigateExpected = InvestigateFixture["expected"];

export const verdictAccuracy = createScorer<InvestigateFixture, MonitorEvalOutcome, InvestigateExpected>({
  name: "Verdict Accuracy",
  description: "Did the agent reach an acceptable verdict? Scored by weighted verdict map.",
  scorer: ({ output, expected }) => {
    if (!expected?.verdicts) return 0;

    // Determine what verdict the agent actually reached
    let actual: "review" | "done" | "followup" | null = null;
    if (output.followupsScheduled.length > 0) {
      actual = "followup";
    } else if (output.statusSet) {
      actual = output.statusSet as "review" | "done";
    }

    if (!actual) return 0;
    return expected.verdicts[actual] ?? 0;
  },
});

export const commentPresence = createScorer<InvestigateFixture, MonitorEvalOutcome, InvestigateExpected>({
  name: "Comment Presence",
  description: "Did the agent leave a comment when expected?",
  scorer: ({ output, expected }) => {
    if (!expected) return 0;
    const commented = output.commentsAdded.length > 0;
    return commented === expected.shouldComment ? 1 : 0;
  },
});

export const commentRelevance = createScorer<InvestigateFixture, MonitorEvalOutcome, InvestigateExpected>({
  name: "Comment Relevance",
  description: "Do comments contain expected keywords?",
  scorer: ({ output, expected }) => {
    if (!expected) return 0;
    const keywords = expected.commentKeywords;
    if (!keywords || keywords.length === 0) return 1;
    if (output.commentsAdded.length === 0) return 0;

    const allComments = output.commentsAdded.join(" ").toLowerCase();
    const matched = keywords.filter((k) => allComments.includes(k.toLowerCase()));
    return matched.length / keywords.length;
  },
});

export const commentQuality = createScorer<InvestigateFixture, MonitorEvalOutcome, InvestigateExpected>({
  name: "Comment Quality",
  description: "LLM judge: is the comment specific, evidence-based, and actionable?",
  scorer: async ({ input, output }) => {
    if (output.commentsAdded.length === 0) return 1; // no comment to judge

    const comment = output.commentsAdded.join("\n\n");
    const { object } = await generateObject({
      model: evalModel,
      temperature: 0,
      schema: z.object({
        specificity: z.number().describe("Does the comment reference specific trace IDs, span names, numbers, or timestamps? 0 = vague, 1 = precise"),
        evidence: z.number().describe("Is the comment grounded in data the agent queried? 0 = speculation, 1 = fully evidence-based"),
        actionability: z.number().describe("Can a developer act on this comment? 0 = no clear next step, 1 = concrete suggested actions"),
        conciseness: z.number().describe("Is the comment concise and free of filler? 0 = verbose/dump, 1 = tight senior-engineer style"),
      }),
      prompt: `You are evaluating a comment written by a monitoring agent to a developer.

## Ticket
**${input.item.title}**
${input.item.description}

## Agent's Comment
${comment}

## Queries the agent ran
${output.queriesRun.map((q, i) => `${i + 1}. ${q}`).join("\n")}

Rate the comment on each dimension from 0 to 1.`,
    });

    const clamp = (n: number) => Math.max(0, Math.min(1, n));
    return (clamp(object.specificity) + clamp(object.evidence) + clamp(object.actionability) + clamp(object.conciseness)) / 4;
  },
});

const PRIORITY_ORDER = ["none", "low", "medium", "high", "critical"];

export const prioritySetting = createScorer<InvestigateFixture, MonitorEvalOutcome, InvestigateExpected>({
  name: "Priority Setting",
  description: "Did the agent set the correct priority?",
  scorer: ({ output, expected }) => {
    if (!expected?.expectedPriority) return 1;
    if (!output.prioritySet) return 0;
    if (output.prioritySet === expected.expectedPriority) return 1;
    const expectedIdx = PRIORITY_ORDER.indexOf(expected.expectedPriority);
    const actualIdx = PRIORITY_ORDER.indexOf(output.prioritySet);
    if (Math.abs(expectedIdx - actualIdx) === 1) return 0.5;
    return 0;
  },
});

export const investigateQueryEfficiency = createScorer<InvestigateFixture, MonitorEvalOutcome, InvestigateExpected>({
  name: "Query Efficiency",
  description: "Did the agent use a reasonable number of queries?",
  scorer: ({ output }) => {
    const n = output.queriesRun.length;
    if (n === 0) return 0;
    if (n <= 8) return 1;
    if (n <= 15) return 0.75;
    return 0.5;
  },
});
