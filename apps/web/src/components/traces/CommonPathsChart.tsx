import { CaretRight, ArrowLeft } from "@phosphor-icons/react";
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
      const parentIds = new Set(
        traceSpans.filter((s) => s.name === parentFilter).map((s) => s.id),
      );
      if (!parentIds.size) continue;
      relevant = traceSpans
        .filter((s) => parentIds.has(s.parentSpanId))
        .sort((a, b) => flowMs(a.startTime) - flowMs(b.startTime));
    } else {
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

const NODE_COLORS = [
  "var(--color-viz-1)",
  "var(--color-viz-5)",
  "var(--color-viz-3)",
  "var(--color-viz-7)",
  "var(--color-viz-9)",
  "var(--color-viz-2)",
  "var(--color-viz-6)",
  "var(--color-viz-10)",
  "var(--color-viz-4)",
  "var(--color-viz-8)",
];

function colorForName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  }
  return NODE_COLORS[Math.abs(hash) % NODE_COLORS.length];
}

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

  const otherEntries = allPaths.slice(limit);
  const otherCount = otherEntries.reduce((s, e) => s + e.count, 0);
  const otherPct = otherEntries.length
    ? otherEntries.reduce((s, e) => s + e.pct, 0)
    : 0;

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-5 pt-5 pb-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          {drillSpanName && (
            <>
              <button
                onClick={() => {
                  setDrillSpanName(null);
                  setExpanded(false);
                }}
                className="flex items-center gap-0.5 text-[11px] text-zinc-500 hover:text-zinc-200 transition-colors cursor-pointer"
              >
                <ArrowLeft size={12} />
              </button>
              <span className="text-zinc-700">|</span>
            </>
          )}
          <p className="text-xs font-medium text-zinc-500">
            {drillSpanName ? (
              <>
                Sub-paths within{" "}
                <span
                  className="inline-block rounded px-1.5 py-px text-[11px] font-medium"
                  style={{
                    color: colorForName(drillSpanName),
                    backgroundColor: `color-mix(in srgb, ${colorForName(drillSpanName)} 12%, transparent)`,
                  }}
                >
                  {drillSpanName}
                </span>
              </>
            ) : (
              "Common agent paths"
            )}
          </p>
        </div>
        {traceCount > 0 && (
          <span className="text-[11px] text-zinc-600 tabular-nums">
            {traceCount} traces
          </span>
        )}
      </div>

      {allPaths.length === 0 ? (
        <p className="text-xs text-zinc-600 py-6 text-center">
          No sub-paths found
        </p>
      ) : (
        <div className="divide-y divide-zinc-800">
          {visible.map((entry, i) => (
            <div key={entry.path.join("→") + i} className="py-2.5 first:pt-0">
              <PathRow
                entry={entry}
                drillableNames={drillableNames}
                onSpanClick={(name) => {
                  setDrillSpanName(name);
                  setExpanded(false);
                }}
              />
            </div>
          ))}

          {otherCount > 0 && !expanded && (
            <div className="flex items-center gap-3 px-1 pt-1">
              <span className="text-[11px] text-zinc-600 tabular-nums w-9 text-right shrink-0">
                +{otherEntries.length}
              </span>
              <div className="flex-1 h-px bg-zinc-800" />
              <span className="text-[11px] text-zinc-600 tabular-nums shrink-0">
                {(otherPct * 100).toFixed(0)}% · {otherCount} traces
              </span>
            </div>
          )}

          {(hasMore || expanded) && allPaths.length > DEFAULT_VISIBLE && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors pl-10 pt-0.5 cursor-pointer"
            >
              {expanded ? "Show less" : `Show all ${allPaths.length} paths`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function PathRow({
  entry,
  drillableNames,
  onSpanClick,
}: {
  entry: PathEntry;
  drillableNames: Set<string>;
  onSpanClick: (name: string) => void;
}) {
  const pctLabel = `${(entry.pct * 100).toFixed(0)}%`;

  return (
    <div className="group flex items-center gap-3 px-1">
      {/* Step pipeline */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-0.5 overflow-x-auto no-scrollbar">
          {entry.path.map((name, j) => {
            const isDrillable = drillableNames.has(name);
            const color = colorForName(name);

            return (
              <span key={j} className="flex items-center gap-0.5 shrink-0">
                {j > 0 && (
                  <CaretRight
                    size={10}
                    className="text-zinc-700 shrink-0"
                    weight="bold"
                  />
                )}
                {isDrillable ? (
                  <button
                    onClick={() => onSpanClick(name)}
                    className="rounded-md border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap transition-all cursor-pointer hover:brightness-125"
                    style={{
                      color,
                      borderColor: `color-mix(in srgb, ${color} 25%, transparent)`,
                      backgroundColor: `color-mix(in srgb, ${color} 8%, transparent)`,
                    }}
                    title={`Drill into "${name}"`}
                  >
                    {name}
                  </button>
                ) : (
                  <span
                    className="rounded-md border border-zinc-800 bg-zinc-800/50 px-2 py-0.5 text-[11px] font-medium text-zinc-400 whitespace-nowrap"
                    title={name}
                  >
                    {name}
                  </span>
                )}
              </span>
            );
          })}
        </div>
      </div>

      {/* Percentage + count */}
      <div className="flex flex-col items-end shrink-0">
        <span className="text-[13px] font-semibold tabular-nums text-zinc-300 leading-none">
          {pctLabel}
        </span>
        <span className="text-[10px] text-zinc-600 tabular-nums leading-tight">
          {entry.count} traces
        </span>
      </div>
    </div>
  );
}
