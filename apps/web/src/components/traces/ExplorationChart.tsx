import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

// Detect ISO date strings like "2026-02-16" or "2026-02-16T00:00:00.000Z"
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}/;

function formatTick(value: unknown): string {
  const s = String(value);
  if (ISO_DATE_RE.test(s)) {
    const d = new Date(s.length === 10 ? s + "T00:00:00" : s);
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
    }
  }
  // Truncate long categorical labels
  return s.length > 18 ? s.slice(0, 16) + "…" : s;
}

function formatTooltipLabel(value: unknown): string {
  const s = String(value);
  if (ISO_DATE_RE.test(s)) {
    const d = new Date(s.length === 10 ? s + "T00:00:00" : s);
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    }
  }
  return s;
}

export const VIZ_COLORS = [
  "var(--color-viz-1)",
  "var(--color-viz-5)",
  "var(--color-viz-7)",
  "var(--color-viz-3)",
  "var(--color-viz-9)",
  "var(--color-viz-2)",
  "var(--color-viz-6)",
  "var(--color-viz-10)",
  "var(--color-viz-4)",
  "var(--color-viz-8)",
];

type LegendEntry = { key: string; label: string; color: string };

interface ExplorationChartProps {
  chartType: "bar" | "line";
  xKey: string;
  yKeys: string[];
  legend?: LegendEntry[];
  data: Record<string, unknown>[];
}

function getColor(
  _key: string,
  index: number,
  _legend?: LegendEntry[]
): string {
  return VIZ_COLORS[index % VIZ_COLORS.length];
}

function getLabel(
  key: string,
  legend?: LegendEntry[]
): string {
  const entry = legend?.find((l) => l.key === key);
  return entry?.label ?? key;
}

export function ExplorationChart({
  chartType,
  xKey,
  yKeys,
  legend,
  data,
}: ExplorationChartProps) {
  if (chartType === "bar") {
    return (
      <ResponsiveContainer width="100%" height={280}>
        <BarChart
          data={data}
          margin={{ top: 4, right: 24, bottom: 0, left: 0 }}
        >
          <CartesianGrid vertical={false} stroke="var(--color-zinc-800)" />
          <XAxis
            dataKey={xKey}
            tickFormatter={formatTick}
            tick={{ fill: "var(--color-zinc-500)", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tickCount={4}
            tick={{ fill: "var(--color-zinc-500)", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={50}
          />
          <Tooltip
            animationDuration={150}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const row = payload[0].payload as Record<string, unknown>;
              return (
                <div className="rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100 shadow-lg">
                  <div className="text-zinc-400 mb-1">
                    {formatTooltipLabel(row[xKey])}
                  </div>
                  {payload.map((p) => (
                    <div
                      key={p.dataKey as string}
                      className="flex items-center gap-1.5"
                    >
                      <span
                        className="inline-block w-2 h-2 rounded-full"
                        style={{ backgroundColor: p.color }}
                      />
                      <span className="text-zinc-400">
                        {getLabel(p.dataKey as string, legend)}:
                      </span>
                      <span className="font-medium">{String(p.value)}</span>
                    </div>
                  ))}
                </div>
              );
            }}
            cursor={{ fill: "var(--color-zinc-800)", opacity: 0.5 }}
          />

          {yKeys.map((key, i) => (
            <Bar
              key={key}
              dataKey={key}
              fill={getColor(key, i, legend)}
              radius={[2, 2, 0, 0]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    );
  }

  // Line chart → rendered as AreaChart to match existing dashboard style
  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart
        data={data}
        margin={{ top: 4, right: 24, bottom: 0, left: 0 }}
      >
        <defs>
          {yKeys.map((key, i) => {
            const color = getColor(key, i, legend);
            return (
              <linearGradient
                key={key}
                id={`grad-exploration-${key}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="0%" stopColor={color} stopOpacity={0.3} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            );
          })}
        </defs>
        <CartesianGrid vertical={false} stroke="var(--color-zinc-800)" />
        <XAxis
          dataKey={xKey}
          tickFormatter={formatTick}
          tick={{ fill: "var(--color-zinc-500)", fontSize: 11 }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tickCount={4}
          tick={{ fill: "var(--color-zinc-500)", fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={50}
        />
        <Tooltip
          animationDuration={150}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const row = payload[0].payload as Record<string, unknown>;
            return (
              <div className="rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100 shadow-lg">
                <div className="text-zinc-400 mb-1">
                  {formatTooltipLabel(row[xKey])}
                </div>
                {payload.map((p) => (
                  <div
                    key={p.dataKey as string}
                    className="flex items-center gap-1.5"
                  >
                    <span
                      className="inline-block w-2 h-2 rounded-full"
                      style={{ backgroundColor: p.color }}
                    />
                    <span className="text-zinc-400">
                      {getLabel(p.dataKey as string, legend)}:
                    </span>
                    <span className="font-medium">{String(p.value)}</span>
                  </div>
                ))}
              </div>
            );
          }}
          cursor={{ stroke: "var(--color-zinc-700)" }}
        />
        {yKeys.map((key, i) => {
          const color = getColor(key, i, legend);
          return (
            <Area
              key={key}
              type="linear"
              dataKey={key}
              stroke={color}
              strokeWidth={1.5}
              fill={`url(#grad-exploration-${key})`}
              dot={false}
              activeDot={{ r: 3, fill: color }}
            />
          );
        })}
      </AreaChart>
    </ResponsiveContainer>
  );
}
