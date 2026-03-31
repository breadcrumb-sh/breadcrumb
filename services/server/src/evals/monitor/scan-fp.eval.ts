/**
 * Scan false positive resistance evals — the scan agent sees noisy-but-normal
 * trace data and should NOT create tickets.
 */

import { generateText, stepCountIs } from "ai";
import { evalite } from "evalite";
import { evalModel } from "./model.js";
import { buildScanPrompt, createScanTools } from "../../services/monitor/scan-agent.js";
import { createEvalScanHandlers } from "./eval-handlers.js";
import { ticketDecision, scanMemoryMaintenance, scanQueryEfficiency } from "./scorers.js";
import type { ScanFixture, MonitorEvalOutcome } from "./types.js";

import singleError from "./fixtures/scan-fp/single-error-healthy-rest.json" with { type: "json" };
import toolRetries from "./fixtures/scan-fp/tool-retries-with-recovery.json" with { type: "json" };
import latencyVariance from "./fixtures/scan-fp/normal-latency-variance.json" with { type: "json" };
import costWithinRange from "./fixtures/scan-fp/cost-within-range.json" with { type: "json" };
import lowVolume from "./fixtures/scan-fp/low-volume-period.json" with { type: "json" };
import newAgent from "./fixtures/scan-fp/new-agent-appeared.json" with { type: "json" };
import highToken from "./fixtures/scan-fp/high-token-long-conversations.json" with { type: "json" };
import modelChange from "./fixtures/scan-fp/model-version-change.json" with { type: "json" };
import emptyRetrieval from "./fixtures/scan-fp/occasional-empty-retrieval.json" with { type: "json" };
import weekendShift from "./fixtures/scan-fp/weekend-pattern-shift.json" with { type: "json" };

const fixtures: ScanFixture[] = [
  singleError as ScanFixture,
  toolRetries as ScanFixture,
  latencyVariance as ScanFixture,
  costWithinRange as ScanFixture,
  lowVolume as ScanFixture,
  newAgent as ScanFixture,
  highToken as ScanFixture,
  modelChange as ScanFixture,
  emptyRetrieval as ScanFixture,
  weekendShift as ScanFixture,
];

evalite<ScanFixture, MonitorEvalOutcome, ScanFixture["expected"]>("Scan False Positive Resistance", {
  data: () => fixtures.map((f) => ({ input: f, expected: f.expected })),
  task: async (fixture) => {
    const { handlers, outcome } = createEvalScanHandlers(fixture);
    const { system, prompt } = buildScanPrompt({ projectMemory: fixture.projectMemory });
    const tools = createScanTools(handlers);

    await generateText({
      model: evalModel,
      system,
      prompt,
      tools,
      temperature: 0,
      maxOutputTokens: 4096,
      stopWhen: stepCountIs(20),
    });

    return outcome;
  },
  scorers: [ticketDecision, scanMemoryMaintenance, scanQueryEfficiency],
});
