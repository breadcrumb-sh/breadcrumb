import { ChartSkeleton } from "../common/ChartSkeleton";

export type SlowestSpan = {
  name: string;
  total: number;
  avgDurationMs: number;
  p95DurationMs: number;
};

function formatDuration(ms: number): string {
  if (!ms || ms <= 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function TopSlowestSpansTable({
  data,
  loading,
}: {
  data: SlowestSpan[] | undefined;
  loading: boolean;
}) {
  return (
    <div
      className="rounded-lg border border-zinc-800 bg-zinc-900 overflow-hidden flex flex-col"
      style={{ height: 290 }}
    >
      <div className="px-5 py-3.5 border-b border-zinc-800 shrink-0">
        <p className="text-xs font-medium text-zinc-500">Top slowest spans</p>
      </div>
      {loading ? (
        <ChartSkeleton variant="table" rows={4} />
      ) : !data?.length ? (
        <div className="flex-1 flex items-center justify-center">
          <span className="text-xs text-zinc-600">No span data</span>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3 px-5 py-2 border-b border-zinc-800 shrink-0">
            <p className="flex-1 text-xs font-medium text-zinc-500">Span</p>
            <p className="w-14 text-right text-xs font-medium text-zinc-500 shrink-0">
              Count
            </p>
            <p className="w-16 text-right text-xs font-medium text-zinc-500 shrink-0">
              Avg
            </p>
            <p className="w-16 text-right text-xs font-medium text-zinc-500 shrink-0">
              p95
            </p>
          </div>
          <div className="divide-y divide-zinc-800 overflow-y-auto flex-1">
            {data.map((row) => (
              <div
                key={row.name}
                className="flex items-center gap-3 px-5 py-2.5"
              >
                <span className="text-xs font-medium text-zinc-100 truncate flex-1">
                  {row.name}
                </span>
                <span className="text-xs text-zinc-500 w-14 text-right shrink-0 tabular-nums">
                  {row.total.toLocaleString()}
                </span>
                <span className="text-xs text-viz-5 w-16 text-right shrink-0 tabular-nums">
                  {formatDuration(row.avgDurationMs)}
                </span>
                <span className="text-xs text-zinc-500 w-16 text-right shrink-0 tabular-nums">
                  {formatDuration(row.p95DurationMs)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
