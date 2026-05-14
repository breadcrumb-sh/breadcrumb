import { ChartSkeleton } from "../common/ChartSkeleton";

export type FailingSpan = {
  name: string;
  total: number;
  errors: number;
  errorRate: number;
};

export function TopFailingSpansTable({
  data,
  loading,
}: {
  data: FailingSpan[] | undefined;
  loading: boolean;
}) {
  return (
    <div
      className="rounded-lg border border-zinc-800 bg-zinc-900 overflow-hidden flex flex-col"
      style={{ height: 290 }}
    >
      <div className="px-5 py-3.5 border-b border-zinc-800 shrink-0">
        <p className="text-xs font-medium text-zinc-500">Top failing spans</p>
      </div>
      {loading ? (
        <ChartSkeleton variant="table" rows={4} />
      ) : !data?.length ? (
        <div className="flex-1 flex items-center justify-center">
          <span className="text-xs text-zinc-600">No failing spans</span>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3 px-5 py-2 border-b border-zinc-800 shrink-0">
            <p className="flex-1 text-xs font-medium text-zinc-500">Span</p>
            <p className="w-14 text-right text-xs font-medium text-zinc-500 shrink-0">
              Errors
            </p>
            <p className="w-14 text-right text-xs font-medium text-zinc-500 shrink-0">
              Total
            </p>
            <p className="w-16 text-right text-xs font-medium text-zinc-500 shrink-0">
              Error %
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
                <span className="text-xs text-viz-7 w-14 text-right shrink-0 tabular-nums">
                  {row.errors.toLocaleString()}
                </span>
                <span className="text-xs text-zinc-500 w-14 text-right shrink-0 tabular-nums">
                  {row.total.toLocaleString()}
                </span>
                <div className="w-16 shrink-0 flex items-center justify-end gap-2">
                  <div className="w-8 h-1 rounded-full bg-zinc-800 overflow-hidden">
                    <div
                      className="h-full bg-viz-7 rounded-full"
                      style={{ width: `${Math.min(row.errorRate, 100)}%` }}
                    />
                  </div>
                  <span className="text-xs text-zinc-500 tabular-nums">
                    {row.errorRate}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
