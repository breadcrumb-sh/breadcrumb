/**
 * Scan false positive resistance evals — the scan agent sees noisy-but-normal
 * trace data and should NOT create tickets.
 *
 * Kept small (4 fixtures) since these are e2e and expensive.
 * Remaining fixtures in scan-fp/ are available for expanded runs.
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
import newAgent from "./fixtures/scan-fp/new-agent-appeared.json" with { type: "json" };
import highToken from "./fixtures/scan-fp/high-token-long-conversations.json" with { type: "json" };

const fixtures: ScanFixture[] = [
  singleError as ScanFixture,
  toolRetries as ScanFixture,
  newAgent as ScanFixture,
  highToken as ScanFixture,
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
      stopWhen: stepCountIs(10),
    });

    return outcome;
  },
  scorers: [ticketDecision, scanMemoryMaintenance, scanQueryEfficiency],
});
