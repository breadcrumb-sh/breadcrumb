/**
 * Scan true positive evals — the scan agent sees real patterns and content
 * quality issues across multiple traces and SHOULD create tickets.
 *
 * Kept small (4 fixtures) since these are e2e and expensive.
 * Remaining fixtures in scan-tp/ are available for expanded runs.
 */

import { generateText, stepCountIs } from "ai";
import { evalite } from "evalite";
import { evalModel } from "./model.js";
import { buildScanPrompt, createScanTools } from "../../services/monitor/scan-agent.js";
import { createEvalScanHandlers } from "./eval-handlers.js";
import { ticketDecision, ticketCount, ticketRelevance, ticketQuality, scanQueryEfficiency } from "./scorers.js";
import type { ScanFixture, MonitorEvalOutcome } from "./types.js";

import repeatedTimeout from "./fixtures/scan-tp/repeated-timeout-pattern.json" with { type: "json" };
import templateVariable from "./fixtures/scan-tp/template-variable-unsubstituted.json" with { type: "json" };
import encodingArtifacts from "./fixtures/scan-tp/encoding-artifacts.json" with { type: "json" };
import retrievalDegradation from "./fixtures/scan-tp/retrieval-quality-degradation.json" with { type: "json" };

const fixtures: ScanFixture[] = [
  repeatedTimeout as ScanFixture,
  templateVariable as ScanFixture,
  encodingArtifacts as ScanFixture,
  retrievalDegradation as ScanFixture,
];

evalite<ScanFixture, MonitorEvalOutcome, ScanFixture["expected"]>("Scan Pattern Detection", {
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
  scorers: [ticketDecision, ticketCount, ticketRelevance, ticketQuality, scanQueryEfficiency],
});
