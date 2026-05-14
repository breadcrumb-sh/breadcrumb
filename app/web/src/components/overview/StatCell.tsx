import { ArrowDown } from "@phosphor-icons/react/ArrowDown";
import { ArrowUp } from "@phosphor-icons/react/ArrowUp";

export function StatCell({
  label,
  value,
  loading,
  delta,
  className = "",
}: {
  label: string;
  value: string;
  loading?: boolean;
  delta?: number | null;
  className?: string;
}) {
  const showDelta = delta != null && isFinite(delta);
  const isUp = showDelta && delta > 0;
  const isDown = showDelta && delta < 0;

  return (
    <div className={`px-5 py-4 space-y-2 ${className}`}>
      <p className="text-xs text-zinc-500">{label}</p>
      <div className="flex items-baseline gap-2">
        <p
          className={`text-2xl font-semibold tracking-tight tabular-nums ${
            loading ? "text-zinc-700 animate-pulse" : "text-zinc-100"
          }`}
        >
          {loading ? "———" : value}
        </p>
        {!loading && showDelta && (
          <span className="inline-flex items-center gap-0.5 text-[11px] tabular-nums font-medium text-zinc-100">
            {isUp ? (
              <ArrowUp size={11} weight="bold" className="text-viz-1" />
            ) : isDown ? (
              <ArrowDown size={11} weight="bold" className="text-viz-7" />
            ) : null}
            {Math.abs(Math.round(delta))}%
          </span>
        )}
      </div>
    </div>
  );
}
