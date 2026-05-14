import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartSkeleton } from "../common/ChartSkeleton";

type QualityData = {
  thresholds: { p75CostUsd: number; p75DurationMs: number };
  days: Array<{
    date: string;
    healthy: number;
    expensive: number;
    failed: number;
  }>;
};

// Stack order: healthy (bottom) -> expensive -> failed (top).
// Only the topmost non-zero segment gets rounded top corners.
export const STACK_KEYS = ["healthy", "expensive", "failed"] as const;

function QualityBarShape(props: unknown) {
  const { x, y, width, height, fill, dataKey, payload } = props as {
    x: number;
    y: number;
    width: number;
    height: number;
    fill: string;
    dataKey: string;
    payload: Record<string, number>;
  };
  if (!height) return <rect x={x} y={y} width={0} height={0} />;

  const idx = STACK_KEYS.indexOf(dataKey as (typeof STACK_KEYS)[number]);
  const isTop = STACK_KEYS.slice(idx + 1).every((k) => !payload[k]);
  const r = isTop ? 3 : 0;

  if (!r) {
    return <rect x={x} y={y} width={width} height={height} fill={fill} />;
  }

  return (
    <path
      fill={fill}
      d={`M${x},${y + height}
          v${-(height - r)}
          a${r},${r} 0 0 1 ${r},${-r}
          h${width - 2 * r}
          a${r},${r} 0 0 1 ${r},${r}
          v${height - r}
          z`}
    />
  );
}

const QUALITY_TOOLTIP_CLS =
  "rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-[11px] text-zinc-300 shadow-lg max-w-[220px]";

function QualityLegendChip({
  color,
  label,
  tooltip,
}: {
  color: string;
  label: string;
  tooltip: string;
}) {
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger
        className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-[10px] text-zinc-400 cursor-default"
        render={<span />}
      >
        <span
          className="inline-block w-2 h-2 rounded-full shrink-0"
          style={{ backgroundColor: color }}
        />
        {label}
      </BaseTooltip.Trigger>
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner sideOffset={6}>
          <BaseTooltip.Popup className={QUALITY_TOOLTIP_CLS}>
            {tooltip}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}

function QualityTooltipContent(props: {
  active?: boolean;
  label?: string;
  payload?: Array<{ name?: string; value?: number; color?: string }>;
}) {
  const { active, label, payload } = props;
  if (!active || !payload?.length || !label) return null;
  const total = payload.reduce((s, p) => s + (p.value ?? 0), 0);
  return (
    <div className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 shadow-lg space-y-1">
      <div className="font-medium text-zinc-400">
        {new Date(label + "T00:00:00").toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        })}
      </div>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2 justify-between">
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ backgroundColor: p.color }}
            />
            {p.name}
          </span>
          <span className="tabular-nums text-zinc-300">
            {p.value}
            {total > 0 && (
              <span className="text-zinc-500 ml-1">
                ({Math.round(((p.value ?? 0) / total) * 100)}%)
              </span>
            )}
          </span>
        </div>
      ))}
      <div className="flex items-center justify-between border-t border-zinc-700 pt-1 mt-1">
        <span className="text-zinc-400">Total</span>
        <span className="tabular-nums text-zinc-100 font-medium">{total}</span>
      </div>
    </div>
  );
}

export function TraceQualityChart({
  data,
  loading,
  from,
  to,
}: {
  data: QualityData | undefined;
  loading: boolean;
  from: string;
  to: string;
}) {
  const thresholds = data?.thresholds;

  // Fill in gap days with zeros and add a total field
  const days = useMemo(() => {
    const raw = data?.days ?? [];
    if (!raw.length)
      return [] as Array<QualityData["days"][number] & { total: number }>;
    const map = new Map(raw.map((d) => [d.date, d]));
    const filled: Array<QualityData["days"][number] & { total: number }> = [];
    const start = new Date(from + "T00:00:00Z");
    const end = new Date(to + "T00:00:00Z");
    for (const d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const key = d.toISOString().slice(0, 10);
      const row = map.get(key) ?? {
        date: key,
        healthy: 0,
        expensive: 0,
        failed: 0,
      };
      filled.push({ ...row, total: row.healthy + row.expensive + row.failed });
    }
    return filled;
  }, [data?.days, from, to]);

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-5 pt-5 pb-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-zinc-500">Trace quality</p>
        <div className="flex flex-wrap gap-1.5">
          <QualityLegendChip
            color="var(--color-viz-1)"
            label="Healthy"
            tooltip="Succeeded with cost and duration within normal range (below p75)."
          />
          <QualityLegendChip
            color="var(--color-viz-5)"
            label="Expensive"
            tooltip={`Succeeded but cost or duration above p75 threshold.${thresholds ? ` Cost > $${thresholds.p75CostUsd.toFixed(4)}, Duration > ${thresholds.p75DurationMs < 1000 ? `${Math.round(thresholds.p75DurationMs)}ms` : `${(thresholds.p75DurationMs / 1000).toFixed(2)}s`}.` : ""}`}
          />
          <QualityLegendChip
            color="var(--color-viz-7)"
            label="Failed"
            tooltip="Traces that returned an error status."
          />
        </div>
      </div>

      <div style={{ height: 280 }}>
        {loading ? (
          <ChartSkeleton variant="bar" />
        ) : !days.length ? (
          <div className="h-full flex items-center justify-center">
            <span className="text-xs text-zinc-600">No trace data</span>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={days}
              margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
            >
              <CartesianGrid
                vertical={false}
                stroke="var(--color-zinc-800)"
                strokeDasharray="3 3"
              />
              <XAxis
                dataKey="date"
                tick={{ fill: "var(--color-zinc-500)", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: string) =>
                  new Date(v + "T00:00:00").toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })
                }
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fill: "var(--color-zinc-500)", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
                width={36}
              />
              <Tooltip
                animationDuration={150}
                content={QualityTooltipContent}
                cursor={{ fill: "var(--color-zinc-800)", opacity: 0.3 }}
              />
              <Bar
                dataKey="healthy"
                name="Healthy"
                stackId="quality"
                fill="var(--color-viz-1)"
                shape={QualityBarShape}
                isAnimationActive={false}
              />
              <Bar
                dataKey="expensive"
                name="Expensive"
                stackId="quality"
                fill="var(--color-viz-5)"
                shape={QualityBarShape}
                isAnimationActive={false}
              />
              <Bar
                dataKey="failed"
                name="Failed"
                stackId="quality"
                fill="var(--color-viz-7)"
                shape={QualityBarShape}
                isAnimationActive={false}
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
