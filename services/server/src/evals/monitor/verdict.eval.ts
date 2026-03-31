/**
 * Granular verdict evals — tests whether the investigation agent makes
 * the correct review/done/followup decision given pre-filled evidence.
 *
 * Each fixture has a pre-written investigation note so the agent doesn't
 * need many tool calls. Same prompt, same tools — just testing the decision.
 */

import { generateText, stepCountIs } from "ai";
import { evalite } from "evalite";
import { evalModel } from "./model.js";
import { buildInvestigatePrompt, createInvestigateTools } from "../../services/monitor/investigate-agent.js";
import { createEvalInvestigateHandlers } from "./eval-handlers.js";
import { verdictAccuracy, commentPresence, commentQuality, prioritySetting, labelSetting } from "./scorers.js";
import type { InvestigateFixture, MonitorEvalOutcome } from "./types.js";

import obviousErrorSpike from "./fixtures/verdict/obvious-error-spike.json" with { type: "json" };
import oneTimeLatencyBlip from "./fixtures/verdict/one-time-latency-blip.json" with { type: "json" };
import alreadyResolved from "./fixtures/verdict/already-resolved.json" with { type: "json" };
import intermittentUnclear from "./fixtures/verdict/intermittent-unclear.json" with { type: "json" };
import costSpikeExplainable from "./fixtures/verdict/cost-spike-explainable.json" with { type: "json" };
import subtleQualityDrop from "./fixtures/verdict/subtle-quality-drop.json" with { type: "json" };
import normalToolRetries from "./fixtures/verdict/normal-tool-retries.json" with { type: "json" };
import insufficientEvidence from "./fixtures/verdict/insufficient-evidence.json" with { type: "json" };
import multipleIssuesOneClear from "./fixtures/verdict/multiple-issues-one-clear.json" with { type: "json" };
import staleTicketNoData from "./fixtures/verdict/stale-ticket-no-data.json" with { type: "json" };
import singleHallucination from "./fixtures/verdict/single-hallucination.json" with { type: "json" };
import newErrorTypeOnce from "./fixtures/verdict/new-error-type-once.json" with { type: "json" };
import briefLatencySpikeRecovered from "./fixtures/verdict/brief-latency-spike-recovered.json" with { type: "json" };
import gradualTokenTrend from "./fixtures/verdict/gradual-token-trend.json" with { type: "json" };

const fixtures: InvestigateFixture[] = [
  obviousErrorSpike as InvestigateFixture,
  oneTimeLatencyBlip as InvestigateFixture,
  alreadyResolved as InvestigateFixture,
  intermittentUnclear as InvestigateFixture,
  costSpikeExplainable as InvestigateFixture,
  subtleQualityDrop as InvestigateFixture,
  normalToolRetries as InvestigateFixture,
  insufficientEvidence as InvestigateFixture,
  multipleIssuesOneClear as InvestigateFixture,
  staleTicketNoData as InvestigateFixture,
  singleHallucination as InvestigateFixture,
  newErrorTypeOnce as InvestigateFixture,
  briefLatencySpikeRecovered as InvestigateFixture,
  gradualTokenTrend as InvestigateFixture,
];

evalite<InvestigateFixture, MonitorEvalOutcome, InvestigateFixture["expected"]>("Verdict Accuracy", {
  data: () => fixtures.map((f) => ({ input: f, expected: f.expected })),
  task: async (fixture) => {
    const { handlers, outcome } = createEvalInvestigateHandlers(fixture);
    const { system, messages } = buildInvestigatePrompt({
      projectMemory: fixture.projectMemory,
      item: fixture.item,
      comments: fixture.comments,
      availableLabels: fixture.availableLabels,
    });
    const tools = createInvestigateTools(handlers);

    await generateText({
      model: evalModel,
      system,
      messages,
      tools,
      temperature: 0,
      maxOutputTokens: 4096,
      stopWhen: stepCountIs(20),
    });

    return outcome;
  },
  scorers: [verdictAccuracy, commentPresence, commentQuality, prioritySetting, labelSetting],
});
