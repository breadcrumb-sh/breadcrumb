/**
 * Evalite evals for the monitor scan agent.
 *
 * Each fixture represents a project state. The eval runs the real scan agent
 * (same prompts, same tools) with fixture-backed handlers instead of real I/O.
 */

import { generateText, stepCountIs } from "ai";
import { evalite } from "evalite";
import { evalModel } from "./model.js";
import { buildScanPrompt, createScanTools } from "../../services/monitor/scan-agent.js";
import { createEvalScanHandlers } from "./eval-handlers.js";
import {
  ticketDecision,
  ticketCount,
  scanMemoryMaintenance,
  scanQueryEfficiency,
  ticketRelevance,
} from "./scorers.js";
import type { ScanFixture, MonitorEvalOutcome } from "./types.js";

import healthyProject from "./fixtures/scan/healthy-project.json" with { type: "json" };

const fixtures: ScanFixture[] = [
  healthyProject as ScanFixture,
];

evalite<ScanFixture, MonitorEvalOutcome, ScanFixture["expected"]>("Monitor Scan", {
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
      stopWhen: stepCountIs(40),
    });

    return outcome;
  },
  scorers: [ticketDecision, ticketCount, scanMemoryMaintenance, scanQueryEfficiency, ticketRelevance],
});
