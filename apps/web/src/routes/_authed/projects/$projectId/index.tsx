import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import { ArrowDown, ArrowUp, DotsThree, Star } from "@phosphor-icons/react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState, useEffect, useRef } from "react";
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
import { z } from "zod";
import { ChartSkeleton } from "../../../../components/ChartSkeleton";
import {
  DateRangePopover,
  presetFrom,
  today,
} from "../../../../components/DateRangePopover";
import { MultiselectCombobox } from "../../../../components/MultiselectCombobox";
import { ExplorationChart } from "../../../../components/traces/ExplorationChart";
import { trpc } from "../../../../lib/trpc";

const searchSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  preset: z.union([z.literal(7), z.literal(30), z.literal(90)]).optional(),
  names: z.array(z.string()).optional(),
  models: z.array(z.string()).optional(),
  env: z.array(z.string()).optional(),
});

export const Route = createFileRoute("/_authed/projects/$projectId/")({
  validateSearch: searchSchema,
  component: OverviewPage,
});

type Metric = "traces" | "cost" | "errors";

function OverviewPage() {
  const { projectId } = Route.useParams();
  const navigate = Route.useNavigate();
  const search = Route.useSearch();

  const from = search.from ?? presetFrom(30);
  const to = search.to ?? today();
  const preset = search.preset ?? 30;
  const selectedNames = search.names ?? [];
  const selectedModels = search.models ?? [];
  const selectedEnvs = search.env ?? [];

  const applyPreset = (days: 7 | 30 | 90) =>
    navigate({
      search: (prev) => ({
        ...prev,
        from: presetFrom(days),
        to: today(),
        preset: days,
      }),
    });

  const handleFromChange = (v: string) =>
    navigate({ search: (prev) => ({ ...prev, from: v, preset: undefined }) });
  const handleToChange = (v: string) =>
    navigate({ search: (prev) => ({ ...prev, to: v, preset: undefined }) });

  const commonFilters = {
    projectId,
    from,
    to,
    environments: selectedEnvs.length > 0 ? selectedEnvs : undefined,
    models: selectedModels.length > 0 ? selectedModels : undefined,
    names: selectedNames.length > 0 ? selectedNames : undefined,
  };

  const stats = trpc.traces.stats.useQuery(commonFilters);
  const daily = trpc.traces.dailyMetrics.useQuery(commonFilters);
  const quality = trpc.traces.qualityTimeline.useQuery(commonFilters);
  const failingSpans = trpc.traces.topFailingSpans.useQuery(commonFilters);
  const slowestSpans = trpc.traces.topSlowestSpans.useQuery(commonFilters);
  const envList = trpc.traces.environments.useQuery({ projectId });
  const modelList = trpc.traces.models.useQuery({ projectId });
  const nameList = trpc.traces.names.useQuery({ projectId });
  const starredCharts = trpc.explores.listStarred.useQuery({ projectId });
  const newFindings = trpc.observations["findings.listNew"].useQuery(
    { projectId },
    { refetchInterval: 30_000 },
  );

  return (
    <main className="px-5 py-6 sm:px-8 sm:py-8 space-y-6">
      {/* ── Filter bar ────────────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Date range */}
        <DateRangePopover
          from={from}
          to={to}
          preset={preset}
          onPreset={applyPreset}
          onCustom={() =>
            navigate({ search: (prev) => ({ ...prev, preset: undefined }) })
          }
          onFromChange={handleFromChange}
          onToChange={handleToChange}
        />

        {/* Divider */}
        <div className="h-4 w-px bg-zinc-800" />

        {/* Trace name multiselect */}
        <MultiselectCombobox
          options={nameList.data ?? []}
          selected={selectedNames}
          onChange={(v) =>
            navigate({
              search: (prev) => ({ ...prev, names: v.length ? v : undefined }),
            })
          }
          placeholder="All traces"
        />

        {/* Environment */}
        <MultiselectCombobox
          options={envList.data ?? []}
          selected={selectedEnvs}
          onChange={(v) =>
            navigate({
              search: (prev) => ({ ...prev, env: v.length ? v : undefined }),
            })
          }
          placeholder="All environments"
        />

        {/* Model */}
        <MultiselectCombobox
          options={modelList.data ?? []}
          selected={selectedModels}
          onChange={(v) =>
            navigate({
              search: (prev) => ({ ...prev, models: v.length ? v : undefined }),
            })
          }
          placeholder="All models"
        />
      </div>

      {/* ── Stat cards ────────────────────────────────────────── */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 grid grid-cols-2 sm:grid-cols-5">
        <StatCell
          label="Traces"
          value={stats.data ? stats.data.traceCount.toLocaleString() : "—"}
          loading={stats.isLoading}
          delta={pctChange(
            stats.data?.traceCount,
            stats.data?.prev?.traceCount,
          )}
        />
        <StatCell
          className="border-l sm:border-l border-zinc-800"
          label="Total cost"
          value={stats.data ? formatCost(stats.data.totalCostUsd) : "—"}
          loading={stats.isLoading}
          delta={pctChange(
            stats.data?.totalCostUsd,
            stats.data?.prev?.totalCostUsd,
          )}
        />
        <StatCell
          className="border-t sm:border-t-0 sm:border-l border-zinc-800"
          label="Avg cost / trace"
          value={
            stats.data
              ? formatCost(
                  stats.data.traceCount > 0
                    ? stats.data.totalCostUsd / stats.data.traceCount
                    : 0,
                )
              : "—"
          }
          loading={stats.isLoading}
          delta={pctChange(
            stats.data && stats.data.traceCount > 0
              ? stats.data.totalCostUsd / stats.data.traceCount
              : undefined,
            stats.data?.prev && stats.data.prev.traceCount > 0
              ? stats.data.prev.totalCostUsd / stats.data.prev.traceCount
              : undefined,
          )}
        />
        <StatCell
          className="border-t border-l sm:border-t-0 sm:border-l border-zinc-800"
          label="Avg duration"
          value={stats.data ? formatDuration(stats.data.avgDurationMs) : "—"}
          loading={stats.isLoading}
          delta={pctChange(
            stats.data?.avgDurationMs,
            stats.data?.prev?.avgDurationMs,
          )}
        />
        <StatCell
          className="border-t sm:border-t-0 sm:border-l border-zinc-800 col-span-2 sm:col-span-1"
          label="Error rate"
          value={stats.data ? formatErrorRate(stats.data.errorRate) : "—"}
          loading={stats.isLoading}
          delta={pctChange(stats.data?.errorRate, stats.data?.prev?.errorRate)}
        />
      </div>

      {/* ── Hero: Trace Quality ──────────────────────────────── */}
      <TraceQualityChart
        data={quality.data}
        loading={quality.isLoading}
        from={from}
        to={to}
      />

      {/* ── New observation findings ─────────────────────────── */}
      {(newFindings.data?.length ?? 0) > 0 && (
        <div className="flex flex-col sm:flex-row gap-3">
          {newFindings.data!.map((f) => {
            const impactStyles =
              f.impact === "high"
                ? { badge: "border-red-600/30 bg-red-500/10 text-red-400", bar: "bg-red-500" }
                : f.impact === "medium"
                  ? { badge: "border-amber-600/30 bg-amber-500/10 text-amber-400", bar: "bg-amber-500" }
                  : { badge: "border-zinc-600 bg-zinc-800/50 text-zinc-400", bar: "bg-zinc-500" };
            return (
              <div
                key={f.id}
                className="flex-1 rounded-lg border border-zinc-800 bg-zinc-900 overflow-hidden min-w-0 flex flex-col"
              >
                <div className={`h-0.5 ${impactStyles.bar}`} />
                <div className="px-5 pt-4 pb-4 flex flex-col flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`shrink-0 inline-flex items-center rounded border px-1.5 py-px text-[10px] font-medium leading-none ${impactStyles.badge}`}>
                      {f.impact}
                    </span>
                    {f.observationName && (
                      <span className="text-[10px] text-zinc-500 truncate">{f.observationName}</span>
                    )}
                  </div>
                  <p className="text-sm font-medium text-zinc-100 leading-snug">{f.title}</p>
                  <p className="text-xs text-zinc-500 mt-1.5 line-clamp-2 flex-1">{f.description}</p>
                  <Link
                    to="/projects/$projectId/traces"
                    params={{ projectId }}
                    search={{ tab: "observations" }}
                    className="mt-3 text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors self-start"
                  >
                    See more →
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Cost charts ────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <ChartCard
          label="Spend over time"
          data={buildChartData(daily.data ?? [], from, to, "cost")}
          loading={daily.isLoading}
          leftMargin={50}
          formatAxis={(v) => `$${formatAxisCost(Number(v))}`}
          formatTooltip={(y) => formatCost(Number(y))}
        />
        <ChartCard
          label="Avg cost per trace"
          data={buildAvgCostData(daily.data ?? [], from, to)}
          loading={daily.isLoading}
          leftMargin={50}
          formatAxis={(v) => `$${formatAxisCost(Number(v))}`}
          formatTooltip={(y) => formatCost(Number(y))}
        />
      </div>

      {/* ── Reliability charts ───────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <ChartCard
          label="Success rate"
          data={buildSuccessRateData(daily.data ?? [], from, to)}
          loading={daily.isLoading}
          yDomain={[0, 100]}
          formatAxis={(v) => `${Number(v)}%`}
          formatTooltip={(y) => `${Number(y).toFixed(1)}%`}
        />
        <TopFailingSpansTable
          data={failingSpans.data}
          loading={failingSpans.isLoading}
        />
      </div>

      {/* ── Latency charts ──────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <ChartCard
          label="Avg duration over time"
          data={buildAvgDurationData(daily.data ?? [], from, to)}
          loading={daily.isLoading}
          formatAxis={(v) => formatDurationAxis(Number(v))}
          formatTooltip={(y) => formatDuration(Number(y))}
        />
        <TopSlowestSpansTable
          data={slowestSpans.data}
          loading={slowestSpans.isLoading}
        />
      </div>

      {/* ── Starred Charts ──────────────────────────────────────── */}
      {starredCharts.data && starredCharts.data.length > 0 && (
        <div className="space-y-4">
          <p className="text-xs font-medium text-zinc-500">Explorations</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {starredCharts.data.map((chart) => (
              <StarredChartCard
                key={chart.id}
                chart={chart}
                projectId={projectId}
              />
            ))}
          </div>
        </div>
      )}
    </main>
  );
}

// ── Chart helpers ──────────────────────────────────────────────────────────────

type DailyMetric = {
  date: string;
  traces: number;
  costUsd: number;
  errors: number;
  avgDurationMs: number;
};

function buildChartData(
  rows: DailyMetric[],
  from: string,
  to: string,
  metric: Metric,
) {
  const map = new Map(
    rows.map((r) => [
      r.date,
      metric === "traces" ? r.traces : metric === "cost" ? r.costUsd : r.errors,
    ]),
  );
  const data: { date: string; value: number }[] = [];
  const start = new Date(from);
  const end = new Date(to);
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    data.push({ date: key, value: map.get(key) ?? 0 });
  }
  return data;
}

function buildAvgCostData(rows: DailyMetric[], from: string, to: string) {
  const map = new Map(rows.map((r) => [r.date, r]));
  const data: { date: string; value: number }[] = [];
  const start = new Date(from);
  const end = new Date(to);
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    const row = map.get(key);
    data.push({
      date: key,
      value: row && row.traces > 0 ? row.costUsd / row.traces : 0,
    });
  }
  return data;
}

function buildSuccessRateData(rows: DailyMetric[], from: string, to: string) {
  const map = new Map(rows.map((r) => [r.date, r]));
  const data: { date: string; value: number }[] = [];
  const start = new Date(from);
  const end = new Date(to);
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    const row = map.get(key);
    const rate =
      row && row.traces > 0
        ? ((row.traces - row.errors) / row.traces) * 100
        : 100;
    data.push({ date: key, value: rate });
  }
  return data;
}

function buildAvgDurationData(rows: DailyMetric[], from: string, to: string) {
  const map = new Map(rows.map((r) => [r.date, r]));
  const data: { date: string; value: number }[] = [];
  const start = new Date(from);
  const end = new Date(to);
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    const row = map.get(key);
    data.push({ date: key, value: row ? row.avgDurationMs : 0 });
  }
  return data;
}

// ── Starred chart card ────────────────────────────────────────────────────────

type StarredChart = {
  id: string;
  title: string | null;
  chartType: string | null;
  sql: string | null;
  xKey: string | null;
  yKeys: unknown;
  legend: unknown;
  exploreId: string;
  exploreName: string;
};

type LegendEntry = { key: string; label: string; color: string };

function StarredChartCard({
  chart,
  projectId,
}: {
  chart: StarredChart;
  projectId: string;
}) {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [menuOpen, setMenuOpen] = useState(false);
  const [chartData, setChartData] = useState<Record<string, unknown>[] | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const removeStar = trpc.explores.unstarChart.useMutation({
    onSettled: () => {
      utils.explores.listStarred.invalidate();
    },
  });

  const requery = trpc.explores.requery.useMutation();

  // Fetch chart data on mount
  useEffect(() => {
    if (!chart.sql) return;
    let cancelled = false;
    requery
      .mutateAsync({ projectId, sql: chart.sql })
      .then((rows) => {
        if (!cancelled) setChartData(rows);
      })
      .catch(() => {
        if (!cancelled) setChartData([]);
      });
    return () => {
      cancelled = true;
    };
  }, [chart.sql, projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  const legend = (chart.legend ?? []) as LegendEntry[];
  const yKeys = (chart.yKeys ?? []) as string[];

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-5 pt-4 pb-4">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <p className="min-w-0 flex-1 text-sm font-medium text-zinc-200 truncate">
          {chart.title ?? "Untitled chart"}
        </p>

        <div className="relative shrink-0 ml-2" ref={menuRef}>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="p-1 rounded text-zinc-600 hover:text-zinc-300 hover:bg-zinc-700/50 transition-colors"
          >
            <DotsThree size={16} weight="bold" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 z-10 w-44 rounded-md border border-zinc-700 bg-zinc-800 py-1 shadow-lg">
              <button
                onClick={() => {
                  removeStar.mutate({ id: chart.id });
                  setMenuOpen(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 transition-colors"
              >
                <Star size={12} />
                Remove star
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false);
                  navigate({
                    to: "/projects/$projectId/explore",
                    params: { projectId },
                    search: { id: chart.exploreId },
                  });
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 transition-colors"
              >
                Go to exploration
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Legend */}
      {legend.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap mb-3">
          {legend.map((entry) => (
            <span
              key={entry.key}
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-[10px] text-zinc-400"
            >
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ backgroundColor: entry.color }}
              />
              {entry.label}
            </span>
          ))}
        </div>
      )}

      {/* Chart */}
      {chartData === null ? (
        <ChartSkeleton variant={chart.chartType === "bar" ? "bar" : "area"} />
      ) : chartData.length > 0 && chart.chartType && chart.xKey && yKeys.length > 0 ? (
        <ExplorationChart
          chartType={chart.chartType as "bar" | "line"}
          xKey={chart.xKey}
          yKeys={yKeys}
          legend={legend.length > 0 ? legend : undefined}
          data={chartData}
        />
      ) : (
        <div className="flex items-center justify-center rounded-md border border-dashed border-zinc-700 bg-zinc-900/50 py-12">
          <p className="text-xs text-zinc-500">No data returned by query</p>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ChartCard({
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

// ── Top Failing Spans Table ────────────────────────────────────────────────────

type FailingSpan = {
  name: string;
  total: number;
  errors: number;
  errorRate: number;
};

function TopFailingSpansTable({
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

// ── Top Slowest Spans Table ───────────────────────────────────────────────────

type SlowestSpan = {
  name: string;
  total: number;
  avgDurationMs: number;
  p95DurationMs: number;
};

function TopSlowestSpansTable({
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

// ── Trace Quality Chart ────────────────────────────────────────────────────────

type QualityData = {
  thresholds: { p75CostUsd: number; p75DurationMs: number };
  days: Array<{
    date: string;
    healthy: number;
    expensive: number;
    failed: number;
  }>;
};

// Stack order: healthy (bottom) → expensive → failed (top).
// Only the topmost non-zero segment gets rounded top corners.
const STACK_KEYS = ["healthy", "expensive", "failed"] as const;

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

function TraceQualityChart({
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
    const start = new Date(from);
    const end = new Date(to);
    for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
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

function StatCell({
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

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns percentage change or null when comparison isn't meaningful. */
function pctChange(current?: number, previous?: number): number | null {
  if (current == null || previous == null) return null;
  if (previous === 0 && current === 0) return null;
  if (previous === 0) return 100; // went from nothing to something
  return ((current - previous) / previous) * 100;
}

// ── Formatters ────────────────────────────────────────────────────────────────

function formatCost(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.001) return `$${usd.toFixed(6)}`;
  if (usd < 1) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function formatAxisCost(usd: number): string {
  if (usd === 0) return "0";
  if (usd < 0.01) return usd.toFixed(4);
  if (usd < 1) return usd.toFixed(3);
  return usd.toFixed(2);
}

function formatDurationAxis(ms: number): string {
  if (!ms || ms <= 0) return "0";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatDuration(ms: number): string {
  if (!ms || ms <= 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatErrorRate(rate: number): string {
  if (rate === 0) return "0%";
  if (rate < 0.001) return "<0.1%";
  return `${(rate * 100).toFixed(1)}%`;
}
