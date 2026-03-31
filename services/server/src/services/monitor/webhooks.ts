/**
 * Webhook delivery for monitor integrations.
 *
 * Sends notifications to Slack/Discord when a ticket is moved to "needs review",
 * filtered by the configured minimum priority threshold.
 */

import { eq } from "drizzle-orm";
import { db } from "../../shared/db/postgres.js";
import { monitorItems, webhookIntegrations } from "../../shared/db/schema.js";
import { boss } from "../../shared/lib/boss.js";
import { createLogger } from "../../shared/lib/logger.js";
import { env } from "../../env.js";

const log = createLogger("webhooks");

const WEBHOOK_JOB = "webhook-deliver";

// Priority ordering for threshold comparison
const PRIORITY_RANK: Record<string, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

function meetsThreshold(itemPriority: string, minPriority: string): boolean {
  if (minPriority === "all") return true;
  return (PRIORITY_RANK[itemPriority] ?? 0) >= (PRIORITY_RANK[minPriority] ?? 0);
}

// ── Enqueue ─────────────────────────────────────────────────────────

interface WebhookJobData {
  projectId: string;
  itemId: string;
}

export async function enqueueWebhooks(projectId: string, itemId: string) {
  await boss.send(WEBHOOK_JOB, { projectId, itemId } satisfies WebhookJobData);
  log.debug({ projectId, itemId }, "enqueued webhook delivery");
}

// ── Worker ──────────────────────────────────────────────────────────

async function handleDeliver(job: { data: WebhookJobData }) {
  const { projectId, itemId } = job.data;

  // Fetch item + enabled webhooks in parallel
  const [[item], webhooks] = await Promise.all([
    db.select().from(monitorItems).where(eq(monitorItems.id, itemId)),
    db.select().from(webhookIntegrations).where(eq(webhookIntegrations.projectId, projectId)),
  ]);

  if (!item) {
    log.warn({ itemId }, "webhook delivery skipped — item not found");
    return;
  }

  const eligible = webhooks.filter((w) => w.enabled && meetsThreshold(item.priority, w.minPriority));

  if (eligible.length === 0) {
    log.debug({ projectId, itemId }, "no eligible webhooks");
    return;
  }

  const results = await Promise.allSettled(
    eligible.map((w) => deliver(w.channel, w.url, item)),
  );

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const webhook = eligible[i];
    if (result.status === "rejected") {
      log.error({ channel: webhook.channel, projectId, err: result.reason }, "webhook delivery failed");
    } else {
      log.info({ channel: webhook.channel, projectId, itemId }, "webhook delivered");
    }
  }

  // If any failed, throw so pgBoss retries the whole job
  const failed = results.filter((r) => r.status === "rejected");
  if (failed.length > 0) {
    throw new Error(`${failed.length}/${results.length} webhook deliveries failed`);
  }
}

// ── Payload formatting & delivery ───────────────────────────────────

const PRIORITY_EMOJI: Record<string, string> = {
  none: "⚪",
  low: "🟢",
  medium: "🟡",
  high: "🟠",
  critical: "🔴",
};

type Item = typeof monitorItems.$inferSelect;

function itemUrl(item: Item): string {
  return `${env.appBaseUrl}/projects/${item.projectId}?item=${item.id}`;
}

function formatSlackPayload(item: Item) {
  const emoji = PRIORITY_EMOJI[item.priority] ?? "⚪";
  const desc = item.description ? `\n${item.description.slice(0, 200)}` : "";

  return {
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${emoji} *<${itemUrl(item)}|${item.title}>*${desc}`,
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `Priority: *${item.priority}* · Moved to *Needs Review*`,
          },
        ],
      },
    ],
  };
}

function formatDiscordPayload(item: Item) {
  const colorMap: Record<string, number> = {
    none: 0x6b7280,
    low: 0x22c55e,
    medium: 0xf59e0b,
    high: 0xf97316,
    critical: 0xef4444,
  };

  return {
    embeds: [
      {
        title: item.title,
        url: itemUrl(item),
        description: item.description?.slice(0, 200) || undefined,
        color: colorMap[item.priority] ?? 0x6b7280,
        footer: {
          text: `Priority: ${item.priority} · Moved to Needs Review`,
        },
      },
    ],
  };
}

async function deliver(channel: string, url: string, item: Item) {
  const payload = channel === "slack" ? formatSlackPayload(item) : formatDiscordPayload(item);

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${channel} webhook returned ${res.status}: ${body.slice(0, 200)}`);
  }
}

// ── Test delivery ───────────────────────────────────────────────────

export async function sendTestWebhook(channel: string, url: string, projectId: string) {
  const fakeItem: Item = {
    id: "00000000-0000-0000-0000-000000000000",
    projectId,
    title: "Test notification from Breadcrumb",
    description: "This is a test message to verify your webhook integration is working correctly.",
    source: "agent",
    status: "review",
    priority: "medium",
    traceNames: [],
    note: "",
    processing: false,
    read: false,
    dismissed: false,
    createdById: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await deliver(channel, url, fakeItem);
}

// ── Registration ────────────────────────────────────────────────────

export async function registerWebhookJobs() {
  await boss.createQueue(WEBHOOK_JOB).catch(() => {});

  await boss.work<WebhookJobData>(WEBHOOK_JOB, { batchSize: 1 }, async ([job]) => {
    try {
      await handleDeliver(job);
    } catch (err) {
      log.error({ err, ...job.data }, "webhook delivery job failed");
      throw err; // pgBoss will retry
    }
  });

  log.info("webhook jobs registered");
}
