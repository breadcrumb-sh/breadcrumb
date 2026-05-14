/**
 * Skeleton loader that mimics chart shapes while data loads.
 * Variants: "area" (line chart), "bar" (bar chart), "table" (rows).
 * Fills its parent container — wrap in a div with a fixed height.
 */
export function ChartSkeleton({
  variant = "area",
  rows = 5,
}: {
  variant?: "area" | "bar" | "table";
  rows?: number;
}) {
  if (variant === "table") return <TableSkeleton rows={rows} />;
  if (variant === "bar") return <BarSkeleton />;
  return <AreaSkeleton />;
}

function AreaSkeleton() {
  return (
    <div className="h-full w-full relative flex flex-col justify-end px-2 pb-4 pt-6 gap-0 overflow-hidden">
      {/* Y-axis ticks */}
      <div className="absolute left-3 top-6 bottom-4 flex flex-col justify-between pointer-events-none">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-2.5 w-6 rounded bg-zinc-800 animate-pulse" />
        ))}
      </div>
      {/* Area shape */}
      <div className="flex-1 relative ml-8">
        <svg
          viewBox="0 0 200 80"
          preserveAspectRatio="none"
          className="w-full h-full"
        >
          <path
            d="M0,60 Q25,55 50,45 T100,35 T150,50 T200,30 V80 H0 Z"
            className="fill-zinc-800/60 animate-pulse"
          />
          <path
            d="M0,60 Q25,55 50,45 T100,35 T150,50 T200,30"
            className="stroke-zinc-700 animate-pulse"
            fill="none"
            strokeWidth="1.5"
          />
        </svg>
      </div>
      {/* X-axis ticks */}
      <div className="flex justify-between ml-8 mt-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-2.5 w-8 rounded bg-zinc-800 animate-pulse" />
        ))}
      </div>
    </div>
  );
}

function BarSkeleton() {
  const bars = [40, 65, 50, 80, 35, 70, 55, 45, 75, 60, 38, 72];
  return (
    <div className="h-full w-full relative flex flex-col justify-end px-2 pb-4 pt-6 overflow-hidden">
      {/* Y-axis ticks */}
      <div className="absolute left-3 top-6 bottom-4 flex flex-col justify-between pointer-events-none">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-2.5 w-6 rounded bg-zinc-800 animate-pulse" />
        ))}
      </div>
      {/* Bars */}
      <div className="flex-1 flex items-end gap-[3%] ml-8">
        {bars.map((h, i) => (
          <div
            key={i}
            className="flex-1 rounded-t bg-zinc-800 animate-pulse"
            style={{ height: `${h}%` }}
          />
        ))}
      </div>
      {/* X-axis ticks */}
      <div className="flex justify-between ml-8 mt-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-2.5 w-8 rounded bg-zinc-800 animate-pulse" />
        ))}
      </div>
    </div>
  );
}

function TableSkeleton({ rows }: { rows: number }) {
  return (
    <div className="h-full w-full flex flex-col">
      {/* Header */}
      <div className="flex gap-4 px-5 py-2.5 border-b border-zinc-800">
        <div className="flex-1 h-3 rounded bg-zinc-800 animate-pulse" />
        <div className="w-12 h-3 rounded bg-zinc-800 animate-pulse" />
        <div className="w-12 h-3 rounded bg-zinc-800 animate-pulse" />
        <div className="w-14 h-3 rounded bg-zinc-800 animate-pulse" />
      </div>
      {/* Rows */}
      <div className="divide-y divide-zinc-800/50 flex-1">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex gap-4 px-5 py-3 items-center">
            <div
              className="flex-1 h-3 rounded bg-zinc-800/70 animate-pulse"
              style={{ maxWidth: `${60 + ((i * 17) % 30)}%` }}
            />
            <div className="w-12 h-3 rounded bg-zinc-800/50 animate-pulse" />
            <div className="w-12 h-3 rounded bg-zinc-800/50 animate-pulse" />
            <div className="w-14 h-3 rounded bg-zinc-800/50 animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}
