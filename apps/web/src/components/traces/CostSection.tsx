import { createFileRoute } from "@tanstack/react-router";
import { formatCost } from "../../lib/span-utils";
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
  const start = new Date(from);
  const end = new Date(to);
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    data.push({ date: key, value: getValue(map.get(key)) });
  }
  return data;
}

function formatAxisCost(usd: number): string {
  if (usd === 0) return "0";
  if (usd < 0.01) return usd.toFixed(4);
  if (usd < 1) return usd.toFixed(3);
  return usd.toFixed(2);
}

function formatTokens(n: number): string {
  if (n === 0) return "0";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function pctChange(current?: number, previous?: number): number | null {
  if (current == null || previous == null) return null;
  if (previous === 0 && current === 0) return null;
  if (previous === 0) return 100;
  return ((current - previous) / previous) * 100;
}

// Use the traces route for search params
const route = createFileRoute("/_authed/projects/$projectId/traces")();

export function CostSection() {
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

      {/* ── Cost stat cards ───────────────────────────────────── */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 grid grid-cols-2 sm:grid-cols-4">
        <StatCell
          label="Total cost"
          value={stats.data ? formatCost(stats.data.totalCostUsd) : "—"}
          loading={stats.isLoading}
          delta={pctChange(
            stats.data?.totalCostUsd,
            stats.data?.prev?.totalCostUsd,
          )}
        />
        <StatCell
          className="border-l border-zinc-800"
          label="Input tokens"
          value={stats.data ? formatTokens(stats.data.inputTokens) : "—"}
          loading={stats.isLoading}
          delta={pctChange(
            stats.data?.inputTokens,
            stats.data?.prev?.inputTokens,
          )}
        />
        <StatCell
          className="border-t sm:border-t-0 sm:border-l border-zinc-800"
          label="Output tokens"
          value={stats.data ? formatTokens(stats.data.outputTokens) : "—"}
          loading={stats.isLoading}
          delta={pctChange(
            stats.data?.outputTokens,
            stats.data?.prev?.outputTokens,
          )}
        />
        <StatCell
          className="border-t border-l sm:border-t-0 sm:border-l border-zinc-800"
          label="Traces"
          value={stats.data ? stats.data.traceCount.toLocaleString() : "—"}
          loading={stats.isLoading}
          delta={pctChange(
            stats.data?.traceCount,
            stats.data?.prev?.traceCount,
          )}
        />
      </div>

      {/* ── Cost charts ──────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <ChartCard
          label="Spend over time"
          data={fillDays(daily.data ?? [], from, to, (r) => r.date, (r) =>
            r ? r.costUsd : 0,
          )}
          loading={daily.isLoading}
          leftMargin={50}
          formatAxis={(v) => `$${formatAxisCost(Number(v))}`}
          formatTooltip={(y) => formatCost(Number(y))}
        />
        <ChartCard
          label="Avg cost per trace"
          data={fillDays(daily.data ?? [], from, to, (r) => r.date, (r) =>
            r && r.traces > 0 ? r.costUsd / r.traces : 0,
          )}
          loading={daily.isLoading}
          leftMargin={50}
          formatAxis={(v) => `$${formatAxisCost(Number(v))}`}
          formatTooltip={(y) => formatCost(Number(y))}
        />
      </div>
    </div>
  );
}
