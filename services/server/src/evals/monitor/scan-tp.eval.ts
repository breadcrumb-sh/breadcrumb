/**
 * Scan true positive evals — the scan agent sees real patterns and content
 * quality issues across multiple traces and SHOULD create tickets.
 */

import { generateText, stepCountIs } from "ai";
import { evalite } from "evalite";
import { evalModel } from "./model.js";
import { buildScanPrompt, createScanTools } from "../../services/monitor/scan-agent.js";
import { createEvalScanHandlers } from "./eval-handlers.js";
import { ticketDecision, ticketCount, ticketRelevance, scanQueryEfficiency } from "./scorers.js";
import type { ScanFixture, MonitorEvalOutcome } from "./types.js";

import jsonStringified from "./fixtures/scan-tp/json-stringified-context.json" with { type: "json" };
import duplicateRetrieval from "./fixtures/scan-tp/duplicate-retrieval-results.json" with { type: "json" };
import templateVariable from "./fixtures/scan-tp/template-variable-unsubstituted.json" with { type: "json" };
import repeatedTimeout from "./fixtures/scan-tp/repeated-timeout-pattern.json" with { type: "json" };
import truncatedPrompt from "./fixtures/scan-tp/truncated-system-prompt.json" with { type: "json" };
import encodingArtifacts from "./fixtures/scan-tp/encoding-artifacts.json" with { type: "json" };
import agentLooping from "./fixtures/scan-tp/agent-looping-pattern.json" with { type: "json" };
import retrievalDegradation from "./fixtures/scan-tp/retrieval-quality-degradation.json" with { type: "json" };

const fixtures: ScanFixture[] = [
  jsonStringified as ScanFixture,
  duplicateRetrieval as ScanFixture,
  templateVariable as ScanFixture,
  repeatedTimeout as ScanFixture,
  truncatedPrompt as ScanFixture,
  encodingArtifacts as ScanFixture,
  agentLooping as ScanFixture,
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
      stopWhen: stepCountIs(20),
    });

    return outcome;
  },
  scorers: [ticketDecision, ticketCount, ticketRelevance, scanQueryEfficiency],
});
