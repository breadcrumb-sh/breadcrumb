/**
 * 03-sdk-error — batch processing with failures and retries with @breadcrumb-sdk/core
 *
 * Processes a batch of support tickets. Classification has a ~40% failure rate.
 * Failed tickets are retried once with a fallback model. The trace captures both
 * the error and the recovery so you can see exactly what failed and how.
 *
 * Shows: error status propagation, nested error spans, retry patterns,
 *        partial batch success, error metadata.
 *
 * Run: npm run sdk-error --workspace=examples
 */

import { init } from "@breadcrumb-sdk/core";
import { config, sleep } from "../config.js";

// ── Mock infrastructure ────────────────────────────────────────────────────────

interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

interface LlmResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

async function callLlm(messages: Message[], model = "gpt-4o-mini", delayMs = 200): Promise<LlmResult> {
  await sleep(delayMs + Math.random() * 150);
  const chars = messages.reduce((n, m) => n + m.content.length, 0);
  return {
    text: `[${model}] Processed: "${messages.at(-1)!.content.slice(0, 50).trim()}..."`,
    inputTokens: Math.floor(chars / 4 + 30),
    outputTokens: Math.floor(20 + Math.random() * 60),
  };
}

// Simulates a flaky downstream classifier service
function maybeThrow(label: string, failRate = 0.4) {
  if (Math.random() < failRate) {
    throw new Error(`${label}: upstream classifier timeout (HTTP 503)`);
  }
}

const CATEGORIES = ["authentication", "billing", "data-export", "webhooks", "mobile"];

// ── Script ────────────────────────────────────────────────────────────────────

const bc = init(config);

const tickets = [
  { id: "TKT-001", text: "Can't log in after password reset — getting invalid token error" },
  { id: "TKT-002", text: "Dashboard charts not loading for enterprise plan users" },
  { id: "TKT-003", text: "Export to CSV produces an empty file for date ranges > 90 days" },
  { id: "TKT-004", text: "Webhook not firing on new subscription events since the v2 API update" },
  { id: "TKT-005", text: "Mobile app crashes when uploading images larger than 5 MB on iOS 17" },
  { id: "TKT-006", text: "Password reset emails going to spam for Outlook users" },
];

const stats = { success: 0, retried: 0, failed: 0 };

await bc.trace("process-ticket-batch", async (root) => {
  root.set({
    input: { tickets: tickets.map((t) => t.text) },
    metadata: { batch_size: String(tickets.length), fail_rate: "0.4" },
  });

  await Promise.all(
    tickets.map((ticket) =>
      bc.span(`ticket-${ticket.id}`, async (span) => {
        span.set({
          input: [{ role: "user", content: ticket.text }],
          metadata: { ticket_id: ticket.id },
        });

        // Step 1: classify the ticket (uses a fast, cheap model — flaky)
        let category: string;
        try {
          category = await bc.span("classify", async (s) => {
            maybeThrow("primary-classifier");  // ~40% failure

            const messages: Message[] = [
              { role: "system", content: "You are a support ticket classifier. Reply with one category word only." },
              { role: "user", content: `Categories: ${CATEGORIES.join(", ")}\n\nTicket: ${ticket.text}` },
            ];
            const result = await callLlm(messages, "gpt-4o-mini", 120);
            s.set({
              input: messages,
              output: result.text,
              model: "gpt-4o-mini",
              provider: "openai",
              input_tokens: result.inputTokens,
              output_tokens: result.outputTokens,
              metadata: { attempt: "1" },
            });
            return CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
          }, { type: "llm" });

        } catch (primaryErr: unknown) {
          // Primary classifier failed — retry once with a more robust model
          stats.retried++;
          const errMsg = primaryErr instanceof Error ? primaryErr.message : String(primaryErr);
          console.log(`  ↻ ${ticket.id}: primary failed, retrying (${errMsg})`);

          category = await bc.span("classify-retry", async (s) => {
            const messages: Message[] = [
              { role: "system", content: "You are a support ticket classifier. Reply with one category word only." },
              { role: "user", content: `Categories: ${CATEGORIES.join(", ")}\n\nTicket: ${ticket.text}` },
            ];
            const result = await callLlm(messages, "claude-haiku-4-5", 200);
            s.set({
              input: messages,
              output: result.text,
              model: "claude-haiku-4-5",
              provider: "anthropic",
              input_tokens: result.inputTokens,
              output_tokens: result.outputTokens,
              metadata: { attempt: "2", fallback_reason: errMsg },
            });
            return CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];
          }, { type: "llm" });
        }

        // Step 2: summarize and suggest a resolution
        const summary = await bc.span("summarize", async (s) => {
          const messages: Message[] = [
            { role: "system", content: "You are a support engineer. Summarize the issue and suggest a resolution in 2 sentences." },
            { role: "user", content: `Category: ${category}\nTicket: ${ticket.text}` },
          ];
          const result = await callLlm(messages, "claude-haiku-4-5", 180);
          s.set({
            input: messages,
            output: result.text,
            model: "claude-haiku-4-5",
            provider: "anthropic",
            input_tokens: result.inputTokens,
            output_tokens: result.outputTokens,
          });
          return result.text;
        }, { type: "llm" });

        span.set({
          output: summary,
          metadata: { category, summary_length: String(summary.length) },
        });

        stats.success++;
        console.log(`  ✓ ${ticket.id} → ${category}`);
      }).catch((err: Error) => {
        // Only gets here if retry also failed (shouldn't in this example, but good practice)
        stats.failed++;
        console.log(`  ✗ ${ticket.id}: ${err.message}`);
      }),
    ),
  );

  root.set({
    output: `Processed ${tickets.length} tickets`,
    metadata: {
      succeeded: String(stats.success),
      retried: String(stats.retried),
      failed: String(stats.failed),
    },
  });
});

console.log(`\nbatch done — ${stats.success} ok, ${stats.retried} retried, ${stats.failed} failed`);
