import type { Breadcrumb } from "@breadcrumb-sdk/core";
import type { Tracer } from "@opentelemetry/api";

export type { Breadcrumb };

// OTel AttributeValue — what the AI SDK's experimental_telemetry.metadata accepts
type AttributeValue =
  | string
  | number
  | boolean
  | string[]
  | number[]
  | boolean[];

export interface InitAiSdkOptions {
  /** Custom OTel tracer — use this when composing with other tools (e.g. Langfuse). */
  tracer?: Tracer;
}

export type TelemetryFn = (
  functionId: string,
  metadata?: Record<string, AttributeValue>,
) => {
  isEnabled: true;
  functionId: string;
  tracer: Tracer;
  metadata?: Record<string, AttributeValue>;
};

/**
 * Integrates Breadcrumb with the Vercel AI SDK (v5 and v6).
 *
 * Returns a `telemetry` function that produces the config object for
 * `experimental_telemetry`. A private OTel tracer is included automatically
 * so AI SDK spans flow to Breadcrumb without registering a global provider.
 *
 * Pass a custom `tracer` in options to use a shared provider alongside
 * other tools (e.g. Langfuse).
 */
export function initAiSdk(
  bc: Breadcrumb,
  options?: InitAiSdkOptions,
): { telemetry: TelemetryFn } {
  const tracer =
    options?.tracer ?? bc.__provider.getTracer("@breadcrumb-sdk/ai-sdk");

  const telemetry: TelemetryFn = (functionId, metadata) => ({
    isEnabled: true,
    functionId,
    tracer,
    ...(metadata !== undefined ? { metadata } : {}),
  });

  return { telemetry };
}
