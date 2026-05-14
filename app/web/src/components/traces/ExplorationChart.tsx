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

/** Format a Date as "YYYY-MM-DD" in a given IANA timezone (falls back to browser local). */
function dateKeyInTz(d: Date, tz?: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  const day = parts.find((p) => p.type === "day")!.value;
  return `${y}-${m}-${day}`;
}

/**
 * If the xKey column looks like ISO dates, build a complete day-by-day spine
 * and merge the query rows into it, zero-filling any gaps.
 *
 * When `from`/`to` are provided (dashboard mode), the spine covers exactly
 * that range — data outside it is discarded. This ensures starred charts
 * visually align with the dashboard's date filter regardless of what the
 * underlying SQL actually fetched.
 *
 * When `from`/`to` are omitted (explore mode), the spine runs from the
 * earliest date in the data through "today" in the project timezone.
 */
function fillDateGaps(
  data: Record<string, unknown>[],
  xKey: string,
  yKeys: string[],
  opts?: { timezone?: string; from?: string; to?: string },
): Record<string, unknown>[] {
  if (data.length === 0) return data;

  // Only apply to date-keyed data
  const firstVal = data[0][xKey];
  if (typeof firstVal !== "string" || !ISO_DATE_RE.test(firstVal)) return data;

  // Index existing rows by their YYYY-MM-DD key; track earliest date string
  const byDate = new Map<string, Record<string, unknown>>();
  let dataMinDate = "";
  for (const row of data) {
    const key = String(row[xKey]).slice(0, 10);
    byDate.set(key, row);
    if (!dataMinDate || key < dataMinDate) dataMinDate = key;
  }

  // Determine the spine boundaries
  const startKey = opts?.from ?? dataMinDate;
  const endKey = opts?.to ?? dateKeyInTz(new Date(), opts?.timezone);

  const result: Record<string, unknown>[] = [];

  // Walk from startKey → endKey using pure calendar arithmetic
  const [sy, smo, sd] = startKey.split("-").map(Number);
  const cursor = new Date(sy, smo - 1, sd);
  const [ey, emo, ed] = endKey.split("-").map(Number);
  const end = new Date(ey, emo - 1, ed);

  while (cursor <= end) {
    const cy = cursor.getFullYear();
    const cm = String(cursor.getMonth() + 1).padStart(2, "0");
    const cd = String(cursor.getDate()).padStart(2, "0");
    const dateKey = `${cy}-${cm}-${cd}`;
    const existing = byDate.get(dateKey);
    if (existing) {
      result.push(existing);
    } else {
      const zero: Record<string, unknown> = { [xKey]: dateKey };
      for (const k of yKeys) zero[k] = 0;
      result.push(zero);
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return result;
}

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
  /** IANA timezone of the project (e.g. "America/New_York"). Used to determine "today" for gap-filling. */
  timezone?: string;
  /** When provided, clip the date spine to this range (YYYY-MM-DD). Used by dashboard charts. */
  from?: string;
  to?: string;
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

/**
 * Coerce y-axis values from strings to numbers.
 *
 * ClickHouse's JSONEachRow format returns UInt64 / aggregate results as strings
 * to avoid JS precision loss. Recharts needs actual numbers for proper axis
 * scaling — without this, a value of "205" is treated as a categorical label
 * and the y-axis domain is wrong.
 */
function coerceNumericValues(
  data: Record<string, unknown>[],
  yKeys: string[],
): Record<string, unknown>[] {
  const ySet = new Set(yKeys);
  return data.map((row) => {
    const copy = { ...row };
    for (const key of ySet) {
      const v = copy[key];
      if (typeof v === "string" && v !== "" && !isNaN(Number(v))) {
        copy[key] = Number(v);
      }
    }
    return copy;
  });
}

export function ExplorationChart({
  chartType,
  xKey,
  yKeys,
  legend,
  data,
  timezone,
  from,
  to,
}: ExplorationChartProps) {
  const coerced = coerceNumericValues(data, yKeys);
  const filledData = fillDateGaps(coerced, xKey, yKeys, { timezone, from, to });

  if (chartType === "bar") {
    return (
      <ResponsiveContainer width="100%" height={280}>
        <BarChart
          data={filledData}
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
            domain={[0, "auto"]}
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
        data={filledData}
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
          domain={[0, "auto"]}
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
