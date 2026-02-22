import type { Status } from "@breadcrumb/core";

export interface BreadcrumbOptions {
  apiKey: string;
  baseUrl: string;
  environment?: string;
  flushInterval?: number;
  maxBatchSize?: number;
  onError?: (err: Error) => void;
}

export interface AgentOptions {
  /** Provide your own ID to resume an existing trace (e.g. for multi-turn sessions). */
  id?: string;
  name: string;
  input?: unknown;
  userId?: string;
  sessionId?: string;
  metadata?: Record<string, string>;
}

export interface AgentEndOptions {
  output?: unknown;
  status?: Status;
  statusMessage?: string;
}

export interface TrackOptions {
  input?: unknown;
  provider?: string;
  model?: string;
  metadata?: Record<string, string>;
}

export interface TimerEndOptions {
  output?: unknown;
  status?: Status;
  statusMessage?: string;
  /** Override the model set at track() time. Useful when the model isn't known until the response arrives. */
  model?: string;
  provider?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  /** Float USD, e.g. 0.000123 */
  inputCostUsd?: number;
  /** Float USD */
  outputCostUsd?: number;
}

export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  inputCostUsd?: number;
  outputCostUsd?: number;
}
