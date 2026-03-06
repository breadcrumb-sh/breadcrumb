import type { Breadcrumb } from "@breadcrumb-sdk/core";

export type { Breadcrumb };

// OTel AttributeValue — what the AI SDK's experimental_telemetry.metadata accepts
type AttributeValue =
  | string
  | number
  | boolean
  | string[]
  | number[]
  | boolean[];

export type TelemetryFn = (
  functionId: string,
  metadata?: Record<string, AttributeValue>,
) => {
  isEnabled: true;
  functionId: string;
  metadata?: Record<string, AttributeValue>;
};

/**
 * Integrates Breadcrumb with the Vercel AI SDK (v5 and v6).
 *
 * The AI SDK emits OpenTelemetry spans automatically when
 * experimental_telemetry is enabled. Because init() registers the OTel
 * provider globally, those spans flow through the BreadcrumbSpanExporter
 * without any additional configuration.
 *
 * A single AI SDK call with no active trace() context becomes its own root
 * trace automatically — no wrapping needed.
 */
export function initAiSdk(_bc: Breadcrumb): { telemetry: TelemetryFn } {
  const telemetry: TelemetryFn = (functionId, metadata) => ({
    isEnabled: true,
    functionId,
    ...(metadata !== undefined ? { metadata } : {}),
  });

  return { telemetry };
}
