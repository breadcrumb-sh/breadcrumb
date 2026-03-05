import { ArrowRight, ArrowLeft } from "@phosphor-icons/react";
import { useMemo, useState } from "react";

type SampleSpan = {
  id: string;
  traceId: string;
  parentSpanId: string;
  name: string;
  type: string;
  status: "ok" | "error";
  startTime: string;
  endTime: string;
};

type PathEntry = {
  path: string[];
  count: number;
  pct: number;
};

function flowMs(chDate: string): number {
  return new Date(chDate.replace(" ", "T") + "Z").getTime();
}

function computePaths(
  spans: SampleSpan[],
  parentFilter?: string,
): PathEntry[] {
  // Group spans by traceId
  const byTrace = new Map<string, SampleSpan[]>();
  for (const s of spans) {
    if (!byTrace.has(s.traceId)) byTrace.set(s.traceId, []);
    byTrace.get(s.traceId)!.push(s);
  }

  const pathCounts = new Map<string, { path: string[]; count: number }>();
  let totalTraces = 0;

  for (const [, traceSpans] of byTrace) {
    let relevant: SampleSpan[];

    if (parentFilter) {
      // Find all span instances matching the parent filter name, then get their direct children
      const parentIds = new Set(
        traceSpans.filter((s) => s.name === parentFilter).map((s) => s.id),
      );
      if (!parentIds.size) continue;
      relevant = traceSpans
        .filter((s) => parentIds.has(s.parentSpanId))
        .sort((a, b) => flowMs(a.startTime) - flowMs(b.startTime));
    } else {
      // Root spans: parentSpanId is empty
      relevant = traceSpans
        .filter((s) => s.parentSpanId === "")
        .sort((a, b) => flowMs(a.startTime) - flowMs(b.startTime));
    }

    if (!relevant.length) continue;
    totalTraces++;

    const path = relevant.map((s) => s.name);
    const key = path.join(" → ");

    if (!pathCounts.has(key)) pathCounts.set(key, { path, count: 0 });
    pathCounts.get(key)!.count++;
  }

  if (!totalTraces) return [];

  return Array.from(pathCounts.values())
    .map((e) => ({ ...e, pct: e.count / totalTraces }))
    .sort((a, b) => b.count - a.count);
}

const DEFAULT_VISIBLE = 5;
const EXPANDED_VISIBLE = 20;

export function CommonPathsChart({
  spans,
  traceCount,
}: {
  spans: SampleSpan[];
  traceCount: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [drillSpanName, setDrillSpanName] = useState<string | null>(null);

  const allPaths = useMemo(
    () => computePaths(spans, drillSpanName ?? undefined),
    [spans, drillSpanName],
  );

  // Precompute which span names actually have children (i.e. are drillable)
  const drillableNames = useMemo(() => {
    const parentIds = new Set(spans.map((s) => s.parentSpanId));
    const namesWithChildren = new Set<string>();
    for (const s of spans) {
      if (parentIds.has(s.id)) namesWithChildren.add(s.name);
    }
    return namesWithChildren;
  }, [spans]);

  if (!allPaths.length && !drillSpanName) return null;

  const limit = expanded ? EXPANDED_VISIBLE : DEFAULT_VISIBLE;
  const visible = allPaths.slice(0, limit);
  const hasMore = allPaths.length > limit;

  // "Other" aggregation
  const otherEntries = allPaths.slice(limit);
  const otherCount = otherEntries.reduce((s, e) => s + e.count, 0);
  const otherPct = otherEntries.length
    ? otherEntries.reduce((s, e) => s + e.pct, 0)
    : 0;

  const maxPct = allPaths[0]?.pct ?? 1;

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-5 pt-5 pb-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {drillSpanName && (
            <button
              onClick={() => {
                setDrillSpanName(null);
                setExpanded(false);
              }}
              className="flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
            >
              <ArrowLeft size={12} weight="bold" />
              Back
            </button>
          )}
          <p className="text-xs font-medium text-zinc-500">
            {drillSpanName
              ? `Sub-paths within "${drillSpanName}"`
              : "Common agent paths"}
          </p>
        </div>
        {traceCount > 0 && (
          <span className="text-[11px] text-zinc-600 tabular-nums">
            {traceCount} traces
          </span>
        )}
      </div>

      {allPaths.length === 0 ? (
        <p className="text-xs text-zinc-600 py-4 text-center">
          No sub-paths found for "{drillSpanName}"
        </p>
      ) : (
        <div className="space-y-1">
          {visible.map((entry, i) => (
            <PathRow
              key={entry.path.join("→") + i}
              rank={i + 1}
              entry={entry}
              maxPct={maxPct}
              drillableNames={drillableNames}
              onSpanClick={(name) => {
                setDrillSpanName(name);
                setExpanded(false);
              }}
            />
          ))}

          {otherCount > 0 && !expanded && (
            <div className="relative flex items-center gap-3 rounded px-3 py-2 text-xs">
              <div
                className="absolute inset-0 rounded bg-zinc-800/30"
                style={{ width: `${(otherPct / maxPct) * 100}%` }}
              />
              <span className="relative text-zinc-600 w-6 text-right tabular-nums shrink-0">
                ...
              </span>
              <span className="relative text-zinc-500 flex-1 truncate">
                {otherEntries.length} other paths
              </span>
              <span className="relative text-zinc-500 tabular-nums shrink-0">
                {(otherPct * 100).toFixed(0)}%
              </span>
              <span className="relative text-zinc-600 tabular-nums shrink-0 text-[11px]">
                ({otherCount})
              </span>
            </div>
          )}

          {(hasMore || expanded) && allPaths.length > DEFAULT_VISIBLE && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors pl-3 pt-1 cursor-pointer"
            >
              {expanded ? "Show less" : `Show more (${allPaths.length} total)`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function PathRow({
  rank,
  entry,
  maxPct,
  drillableNames,
  onSpanClick,
}: {
  rank: number;
  entry: PathEntry;
  maxPct: number;
  drillableNames: Set<string>;
  onSpanClick: (name: string) => void;
}) {
  return (
    <div className="relative flex items-center gap-3 rounded px-3 py-2 text-xs group">
      {/* Background bar */}
      <div
        className="absolute inset-0 rounded bg-zinc-800/40"
        style={{ width: `${(entry.pct / maxPct) * 100}%` }}
      />

      {/* Rank */}
      <span className="relative text-zinc-600 w-6 text-right tabular-nums shrink-0">
        #{rank}
      </span>

      {/* Path */}
      <span className="relative flex items-center gap-1 flex-1 min-w-0 overflow-x-auto no-scrollbar">
        {entry.path.map((name, j) => {
          const isDrillable = drillableNames.has(name);
          return (
            <span key={j} className="flex items-center gap-1 shrink-0">
              {j > 0 && (
                <ArrowRight
                  size={10}
                  className="text-zinc-700 shrink-0"
                  weight="bold"
                />
              )}
              {isDrillable ? (
                <button
                  onClick={() => onSpanClick(name)}
                  className="text-zinc-300 hover:text-white hover:underline underline-offset-2 transition-colors whitespace-nowrap cursor-pointer"
                  title={name}
                >
                  {name}
                </button>
              ) : (
                <span
                  className="text-zinc-300 whitespace-nowrap"
                  title={name}
                >
                  {name}
                </span>
              )}
            </span>
          );
        })}
      </span>

      {/* Percentage */}
      <span className="relative text-zinc-400 tabular-nums shrink-0">
        {(entry.pct * 100).toFixed(0)}%
      </span>

      {/* Count */}
      <span className="relative text-zinc-600 tabular-nums shrink-0 text-[11px]">
        ({entry.count})
      </span>
    </div>
  );
}
