import { parseMs } from "../../lib/span-utils";

export function spanDurationMs(start: string, end: string): number {
  return parseMs(end) - parseMs(start);
}

export function fmtMs(ms: number): string {
  if (!ms || ms < 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function formatTime(chDate: string): string {
  return new Date(chDate.replace(" ", "T") + "Z").toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
