import { createFileRoute } from "@tanstack/react-router";
import {
  DateRangePopover,
  presetFrom,
  today,
} from "../common/DateRangePopover";
import { MultiselectCombobox } from "../common/MultiselectCombobox";
import { useProjectFilters } from "../../hooks/useProjectFilters";
import { trpc } from "../../lib/trpc";
import { StatCell } from "../overview/StatCell";
import { ChartCard } from "../overview/ChartCard";
import { TopSlowestSpansTable } from "../overview/TopSlowestSpansTable";

const EMPTY_STRINGS: string[] = [];

type DailyMetric = {
  date: string;
  traces: number;
  costUsd: number;
  errors: number;
  avgDurationMs: number;
};

function fillDays<T>(
  rows: T[],
  from: string,
  to: string,
  getKey: (row: T) => string,
  getValue: (row: T | undefined) => number,
): { date: string; value: number }[] {
  const map = new Map(rows.map((r) => [getKey(r), r]));
  const data: { date: string; value: number }[] = [];
  const start = new Date(from + "T00:00:00Z");
  const end = new Date(to + "T00:00:00Z");
  for (const d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    data.push({ date: key, value: getValue(map.get(key)) });
  }
  return data;
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

function pctChange(current?: number, previous?: number): number | null {
  if (current == null || previous == null) return null;
  if (previous === 0 && current === 0) return null;
  if (previous === 0) return 100;
  return ((current - previous) / previous) * 100;
}

const route = createFileRoute("/_authed/projects/$projectId/traces")();

export function LatencySection() {
  const { projectId } = route.useParams();
  const [filters, setFilters] = useProjectFilters(projectId);

  const from = filters.from ?? presetFrom(30);
  const to = filters.to ?? today();
  const preset = filters.preset ?? 30;
  const selectedNames = filters.names ?? EMPTY_STRINGS;
  const selectedModels = filters.models ?? EMPTY_STRINGS;
  const selectedEnvs = filters.env ?? EMPTY_STRINGS;

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
  const slowestSpans = trpc.traces.topSlowestSpans.useQuery(commonFilters);
  const envList = trpc.traces.environments.useQuery({ projectId });
  const modelList = trpc.traces.models.useQuery({ projectId });
  const nameList = trpc.traces.names.useQuery({ projectId });

  return (
    <div className="space-y-6">
      {/* ── Filter bar ────────────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">
        <DateRangePopover from={from} to={to} preset={preset} onPreset={(days) => setFilters((p) => ({ ...p, from: presetFrom(days), to: today(), preset: days }))} onCustom={() => setFilters((p) => ({ ...p, preset: undefined }))} onFromChange={(v) => setFilters((p) => ({ ...p, from: v, preset: undefined }))} onToChange={(v) => setFilters((p) => ({ ...p, to: v, preset: undefined }))} />
        <MultiselectCombobox options={nameList.data ?? []} selected={selectedNames} onChange={(v) => setFilters((p) => ({ ...p, names: v.length ? v : undefined }))} placeholder="All traces" />
        <MultiselectCombobox options={envList.data ?? []} selected={selectedEnvs} onChange={(v) => setFilters((p) => ({ ...p, env: v.length ? v : undefined }))} placeholder="All environments" />
        <MultiselectCombobox options={modelList.data ?? []} selected={selectedModels} onChange={(v) => setFilters((p) => ({ ...p, models: v.length ? v : undefined }))} placeholder="All models" />
      </div>

      {/* ── Latency stat cards ────────────────────────────────── */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 grid grid-cols-2">
        <StatCell
          label="Avg duration"
          value={stats.data ? formatDuration(stats.data.avgDurationMs) : "—"}
          loading={stats.isLoading}
          delta={pctChange(
            stats.data?.avgDurationMs,
            stats.data?.prev?.avgDurationMs,
          )}
        />
        <StatCell
          className="border-l border-zinc-800"
          label="Traces"
          value={stats.data ? stats.data.traceCount.toLocaleString() : "—"}
          loading={stats.isLoading}
          delta={pctChange(
            stats.data?.traceCount,
            stats.data?.prev?.traceCount,
          )}
        />
      </div>

      {/* ── Duration charts ──────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <ChartCard
          label="Avg duration over time"
          data={fillDays(daily.data ?? [], from, to, (r) => r.date, (r) =>
            r ? r.avgDurationMs : 0,
          )}
          loading={daily.isLoading}
          formatAxis={(v) => formatDurationAxis(Number(v))}
          formatTooltip={(y) => formatDuration(Number(y))}
        />
        <TopSlowestSpansTable
          data={slowestSpans.data}
          loading={slowestSpans.isLoading}
        />
      </div>
    </div>
  );
}
