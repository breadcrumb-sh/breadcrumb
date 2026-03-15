import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { formatCost } from "../../../../lib/span-utils";
import {
  DateRangePopover,
  presetFrom,
  today,
} from "../../../../components/common/DateRangePopover";
import { MultiselectCombobox } from "../../../../components/common/MultiselectCombobox";
import { trpc } from "../../../../lib/trpc";
import { StatCell } from "../../../../components/overview/StatCell";
import { ChartCard } from "../../../../components/overview/ChartCard";
import { TraceQualityChart } from "../../../../components/overview/TraceQualityChart";
import { StarredChartCard } from "../../../../components/overview/StarredChartCard";
import { TopFailingSpansTable } from "../../../../components/overview/TopFailingSpansTable";
import { TopSlowestSpansTable } from "../../../../components/overview/TopSlowestSpansTable";
import { NewFindingsCards } from "../../../../components/overview/NewFindingsCards";

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

const EMPTY_STRINGS: string[] = [];

function OverviewPage() {
  const { projectId } = Route.useParams();
  const navigate = Route.useNavigate();
  const search = Route.useSearch();

  const from = search.from ?? presetFrom(30);
  const to = search.to ?? today();
  const preset = search.preset ?? 30;
  const selectedNames = search.names ?? EMPTY_STRINGS;
  const selectedModels = search.models ?? EMPTY_STRINGS;
  const selectedEnvs = search.env ?? EMPTY_STRINGS;

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
          label="Tokens"
          value={stats.data ? formatTokens(stats.data.totalTokens) : "—"}
          loading={stats.isLoading}
          delta={pctChange(
            stats.data?.totalTokens,
            stats.data?.prev?.totalTokens,
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
        <NewFindingsCards
          findings={newFindings.data!}
          projectId={projectId}
        />
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

/** Fill every calendar day between `from` and `to` with a value derived from the row map. */
function fillDays<T>(
  rows: T[],
  from: string,
  to: string,
  getKey: (row: T) => string,
  getValue: (row: T | undefined) => number,
): { date: string; value: number }[] {
  const map = new Map(rows.map((r) => [getKey(r), r]));
  const data: { date: string; value: number }[] = [];
  const start = new Date(from);
  const end = new Date(to);
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    data.push({ date: key, value: getValue(map.get(key)) });
  }
  return data;
}

function buildChartData(rows: DailyMetric[], from: string, to: string, metric: Metric) {
  return fillDays(rows, from, to, (r) => r.date, (r) =>
    r ? (metric === "traces" ? r.traces : metric === "cost" ? r.costUsd : r.errors) : 0,
  );
}

function buildAvgCostData(rows: DailyMetric[], from: string, to: string) {
  return fillDays(rows, from, to, (r) => r.date, (r) =>
    r && r.traces > 0 ? r.costUsd / r.traces : 0,
  );
}

function buildSuccessRateData(rows: DailyMetric[], from: string, to: string) {
  return fillDays(rows, from, to, (r) => r.date, (r) =>
    r && r.traces > 0 ? ((r.traces - r.errors) / r.traces) * 100 : 100,
  );
}

function buildAvgDurationData(rows: DailyMetric[], from: string, to: string) {
  return fillDays(rows, from, to, (r) => r.date, (r) => (r ? r.avgDurationMs : 0));
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

function formatTokens(n: number): string {
  if (n === 0) return "0";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatErrorRate(rate: number): string {
  if (rate === 0) return "0%";
  if (rate < 0.001) return "<0.1%";
  return `${(rate * 100).toFixed(1)}%`;
}
