/**
 * 03-sdk-error — batch processing with random failures with @breadcrumb-sdk/core
 *
 * Processes a batch of support tickets. Each item goes through classification
 * and summarization. Classification randomly fails ~40% of the time to
 * demonstrate how errors surface in traces.
 * Shows: error status, partial batch success, error message propagation.
 *
 * Run: npm run sdk-error --workspace=examples
 */

import { init } from "@breadcrumb-sdk/core";
import { config, sleep } from "../config.js";

// ── Mock LLM ─────────────────────────────────────────────────────────────────

interface LlmResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

async function callLlm(prompt: string, delayMs = 300): Promise<LlmResult> {
  await sleep(delayMs + Math.random() * 200);
  return {
    text: `Processed: "${prompt.slice(0, 40).trim()}..."`,
    inputTokens: Math.floor(prompt.length / 4 + 30),
    outputTokens: Math.floor(20 + Math.random() * 50),
  };
}

// Simulates a flaky downstream service
function maybeThrow(label: string, failRate = 0.4) {
  if (Math.random() < failRate) {
    throw new Error(`${label}: upstream service timeout`);
  }
}

// ── Script ───────────────────────────────────────────────────────────────────

const bc = init(config);

const tickets = [
  { id: "TKT-001", text: "Can't log in after password reset" },
  { id: "TKT-002", text: "Dashboard charts not loading for enterprise plan" },
  { id: "TKT-003", text: "Export to CSV produces empty file" },
  { id: "TKT-004", text: "Webhook not firing on new subscription events" },
  { id: "TKT-005", text: "Mobile app crashes when uploading images > 5MB" },
];

const results = { success: 0, failed: 0 };

await bc.trace("process-ticket-batch", async (root) => {
  root.set({ metadata: { batch_size: tickets.length } });

  await Promise.all(
    tickets.map((ticket) =>
      bc.span(`ticket-${ticket.id}`, async (span) => {
        span.set({ input: ticket.text, metadata: { ticket_id: ticket.id } });

        // Step 1: Classify the ticket category
        const category = await bc.span("classify", async (s) => {
          maybeThrow("classifier");  // ~40% chance of failure
          const prompt = `Classify this support ticket: ${ticket.text}`;
          const result = await callLlm(prompt, 150);
          s.set({
            input: prompt,
            output: result.text,
            model: "gpt-4o-mini",
            provider: "openai",
            input_tokens: result.inputTokens,
            output_tokens: result.outputTokens,
            metadata: { category: "authentication" },
          });
          return "authentication";
        }, { type: "llm" });

        // Step 2: Summarize and suggest a resolution
        const summary = await bc.span("summarize", async (s) => {
          const prompt = `Summarize and suggest resolution for: ${ticket.text}`;
          const result = await callLlm(prompt, 200);
          s.set({
            input: prompt,
            output: result.text,
            model: "claude-haiku-4-5",
            provider: "anthropic",
            input_tokens: result.inputTokens,
            output_tokens: result.outputTokens,
          });
          return result.text;
        }, { type: "llm" });

        span.set({ output: summary, metadata: { category, summary_length: summary.length } });
        results.success++;
        console.log(`✓ ${ticket.id} (${category})`);
      }).catch((err: Error) => {
        // Catch per-ticket errors so the rest of the batch continues
        results.failed++;
        console.log(`✗ ${ticket.id}: ${err.message}`);
      }),
    ),
  );

  root.set({ metadata: { succeeded: results.success, failed: results.failed } });
});

console.log(`\nbatch done — ${results.success} succeeded, ${results.failed} failed`);
