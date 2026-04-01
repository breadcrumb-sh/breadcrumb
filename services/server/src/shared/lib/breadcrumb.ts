/**
 * Optional Breadcrumb self-tracing.
 * Only active when BREADCRUMB_API_KEY and BREADCRUMB_BASE_URL are set.
 */

import { env } from "../../env.js";
import type { TelemetryFn } from "@breadcrumb-sdk/ai-sdk";

let telemetryFn: TelemetryFn | null = null;

export async function initBreadcrumb() {
  if (!env.breadcrumbApiKey || !env.breadcrumbBaseUrl) return;

  const { init } = await import("@breadcrumb-sdk/core");
  const { initAiSdk } = await import("@breadcrumb-sdk/ai-sdk");

  const bc = init({
    apiKey: env.breadcrumbApiKey,
    baseUrl: env.breadcrumbBaseUrl,
    batching: false,
  });

  const { telemetry } = initAiSdk(bc);
  telemetryFn = telemetry;
}

/**
 * Returns telemetry config for AI SDK calls, or undefined if not configured.
 */
export function getTelemetry(functionId: string, metadata?: Record<string, string | number | boolean>) {
  if (!telemetryFn) return undefined;
  return telemetryFn(functionId, metadata);
}
