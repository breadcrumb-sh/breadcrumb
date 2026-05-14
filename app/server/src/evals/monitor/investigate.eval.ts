/**
 * Evalite evals for the monitor investigation agent.
 *
 * Each fixture represents a ticket + project state. The eval runs the real
 * investigation agent with fixture-backed handlers instead of real I/O.
 */

import { generateText, stepCountIs } from "ai";
import { evalite } from "evalite";
import { evalModel } from "./model.js";
import { buildInvestigatePrompt, createInvestigateTools } from "../../services/monitor/investigate-agent.js";
import { createEvalInvestigateHandlers } from "./eval-handlers.js";
import {
  verdictAccuracy,
  commentPresence,
  commentRelevance,
  commentQuality,
  prioritySetting,
  investigateQueryEfficiency,
} from "./scorers.js";
import type { InvestigateFixture, MonitorEvalOutcome } from "./types.js";

import falsePositiveTimeout from "./fixtures/investigate/false-positive-timeout.json" with { type: "json" };

const fixtures: InvestigateFixture[] = [
  falsePositiveTimeout as InvestigateFixture,
];

evalite<InvestigateFixture, MonitorEvalOutcome, InvestigateFixture["expected"]>("Monitor Investigation", {
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
      stopWhen: stepCountIs(40),
    });

    return outcome;
  },
  scorers: [
    verdictAccuracy,
    commentPresence,
    commentRelevance,
    commentQuality,
    prioritySetting,
    investigateQueryEfficiency,
  ],
});
