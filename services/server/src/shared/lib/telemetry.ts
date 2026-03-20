import { PostHog } from "posthog-node";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/postgres.js";
import { instanceSettings, user, organization } from "../db/schema.js";
import { env } from "../../env.js";
import { createLogger } from "./logger.js";

const log = createLogger("telemetry");

const POSTHOG_KEY = "phc_lea3h9RaPbSwQzz2e9AF32oXnLt3O3MnDTO6uZuRm07";
const POSTHOG_HOST = "https://eu.i.posthog.com";
const INSTANCE_ID_KEY = "telemetry_instance_id";

let posthog: PostHog | null = null;
let instanceId: string | null = null;

async function getOrCreateInstanceId(): Promise<string> {
  const existing = await db
    .select()
    .from(instanceSettings)
    .where(eq(instanceSettings.key, INSTANCE_ID_KEY))
    .limit(1);

  if (existing.length > 0) {
    return existing[0].value;
  }

  const id = randomUUID();
  await db.insert(instanceSettings).values({ key: INSTANCE_ID_KEY, value: id });
  return id;
}

export async function initTelemetry() {
  if (env.disableTelemetry) {
    log.info("telemetry disabled");
    return;
  }

  try {
    instanceId = await getOrCreateInstanceId();
    posthog = new PostHog(POSTHOG_KEY, {
      host: POSTHOG_HOST,
      disableGeoip: true,
    });
    log.info("telemetry initialized");
  } catch (err) {
    log.warn({ err }, "failed to initialize telemetry — continuing without it");
  }
}

export function getInstanceId(): string | null {
  return instanceId;
}

export function trackEvent(
  event: string,
  properties?: Record<string, unknown>,
) {
  if (!posthog || !instanceId) return;

  try {
    posthog.capture({
      distinctId: instanceId,
      event,
      properties,
    });
  } catch {
    // Telemetry should never break the app
  }
}

export async function getUserCount(): Promise<number> {
  try {
    const [row] = await db.select({ count: sql<number>`count(*)` }).from(user);
    return Number(row.count);
  } catch {
    return 0;
  }
}

export async function getProjectCount(): Promise<number> {
  try {
    const [row] = await db.select({ count: sql<number>`count(*)` }).from(organization);
    return Number(row.count);
  } catch {
    return 0;
  }
}

export async function trackServerStarted() {
  const [userCount, projectCount] = await Promise.all([
    getUserCount(),
    getProjectCount(),
  ]);
  trackEvent("server_started", {
    node_version: process.version,
    user_count: userCount,
    project_count: projectCount,
  });
}

export async function trackUserSignedUp() {
  const userCount = await getUserCount();
  trackEvent("user_signed_up", { user_count: userCount });
}

export async function trackProjectCreated() {
  const projectCount = await getProjectCount();
  trackEvent("project_created", { project_count: projectCount });
}

export function trackTraceIngested() {
  trackEvent("trace_ingested");
}

// ── Feature events ──────────────────────────────────────────────────

export function trackApiKeyCreated() {
  trackEvent("api_key_created");
}

export function trackMcpKeyCreated() {
  trackEvent("mcp_key_created");
}

export function trackAiProviderConfigured(provider: string) {
  trackEvent("ai_provider_configured", { provider });
}

export function trackObservationCreated(opts: {
  sampling_rate: number;
  has_heuristics: boolean;
  trace_filter_count: number;
}) {
  trackEvent("observation_created", opts);
}

export function trackObservationToggled(enabled: boolean) {
  trackEvent("observation_toggled", { enabled });
}

export function trackFindingDismissed(impact: string) {
  trackEvent("finding_dismissed", { impact });
}

export function trackFindingCreated(impact: string) {
  trackEvent("finding_created", { impact });
}

export function trackExploreMessageSent() {
  trackEvent("explore_message_sent");
}

export function trackExploreChartStarred() {
  trackEvent("explore_chart_starred");
}

export function trackMemberInvited(role: string) {
  trackEvent("member_invited", { role });
}

export function trackMcpToolUsed(toolName: string) {
  trackEvent("mcp_tool_used", { tool_name: toolName });
}

export function trackQueryRejected(source: string, code: string, details: string[]) {
  trackEvent("query_rejected", { source, code, detail_count: details.length });
}

// ── Performance events ──────────────────────────────────────────────
// Only sent when a threshold is exceeded to avoid noise.

const TRPC_SLOW_MS = 1000;
const CLICKHOUSE_SLOW_MS = 500;
const INGEST_SLOW_MS = 500;

export function trackSlowTrpcRequest(procedure: string, durationMs: number, ok: boolean) {
  if (durationMs < TRPC_SLOW_MS) return;
  trackEvent("slow_trpc_request", {
    procedure,
    duration_ms: Math.round(durationMs),
    ok,
  });
}

export function trackSlowClickhouseQuery(source: string, durationMs: number) {
  if (durationMs < CLICKHOUSE_SLOW_MS) return;
  trackEvent("slow_clickhouse_query", {
    source,
    duration_ms: Math.round(durationMs),
  });
}

export function trackSlowIngestBatch(table: string, rowCount: number, durationMs: number) {
  if (durationMs < INGEST_SLOW_MS) return;
  trackEvent("slow_ingest_batch", {
    table,
    row_count: rowCount,
    duration_ms: Math.round(durationMs),
  });
}

export async function shutdownTelemetry() {
  if (!posthog) return;

  try {
    await posthog.shutdown();
  } catch {
    // Best-effort
  }
}
