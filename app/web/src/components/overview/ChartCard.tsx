import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartSkeleton } from "../common/ChartSkeleton";

export function ChartCard({
  label,
  data,
  loading,
  leftMargin = 36,
  yDomain,
  formatAxis,
  formatTooltip,
}: {
  label: string;
  data: { date: string; value: number }[];
  loading?: boolean;
  leftMargin?: number;
  yDomain?: [number, number];
  formatAxis?: (v: number) => string;
  formatTooltip?: (y: number) => string;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-5 pt-5 pb-4">
      <p className="text-xs font-medium text-zinc-500 mb-4">{label}</p>
      <div style={{ height: 220 }}>
        {loading ? (
          <ChartSkeleton variant="area" />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={data}
              margin={{ top: 4, right: 4, bottom: 0, left: leftMargin - 36 }}
            >
              <defs>
                <linearGradient
                  id={`grad-${label.replace(/\s+/g, "-")}`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop offset="0%" stopColor="var(--color-viz-1)" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="var(--color-viz-1)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--color-zinc-800)" />
              <XAxis
                dataKey="date"
                tickFormatter={(v: string) => {
                  const d = new Date(v + "T00:00:00");
                  return d.toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  });
                }}
                tick={{ fill: "var(--color-zinc-500)", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tickCount={4}
                domain={yDomain}
                tickFormatter={
                  formatAxis ? (v: number) => formatAxis(v) : undefined
                }
                tick={{ fill: "var(--color-zinc-500)", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={leftMargin}
              />
              <Tooltip
                animationDuration={150}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const row = payload[0].payload as {
                    date: string;
                    value: number;
                  };
                  const d = new Date(row.date + "T00:00:00");
                  const label = d.toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  });
                  return (
                    <div className="rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100 shadow-lg">
                      <span className="text-zinc-400">{label}</span>
                      {" - "}
                      <span className="font-medium">
                        {formatTooltip
                          ? formatTooltip(row.value)
                          : String(row.value)}
                      </span>
                    </div>
                  );
                }}
                cursor={{ stroke: "var(--color-zinc-700)" }}
              />
              <Area
                type="linear"
                dataKey="value"
                stroke="var(--color-viz-1)"
                strokeWidth={1.5}
                fill={`url(#grad-${label.replace(/\s+/g, "-")})`}
                dot={false}
                activeDot={{ r: 3, fill: "var(--color-viz-1)" }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
