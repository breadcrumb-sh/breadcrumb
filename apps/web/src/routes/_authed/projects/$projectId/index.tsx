import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  DateRangePopover,
  presetFrom,
  today,
} from "../../../../components/common/DateRangePopover";
import { MultiselectCombobox } from "../../../../components/common/MultiselectCombobox";
import { usePageView } from "../../../../hooks/usePageView";
import { useProjectFilters } from "../../../../hooks/useProjectFilters";
import { formatCost } from "../../../../lib/span-utils";
import { trpc } from "../../../../lib/trpc";
import { StatCell } from "../../../../components/overview/StatCell";

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

const EMPTY_STRINGS: string[] = [];

function OverviewPage() {
  usePageView("overview");
  const { projectId } = Route.useParams();
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
  const envList = trpc.traces.environments.useQuery({ projectId });
  const modelList = trpc.traces.models.useQuery({ projectId });
  const nameList = trpc.traces.names.useQuery({ projectId });

  return (
    <main className="px-5 py-6 sm:px-8 sm:py-8 space-y-6 page-container-small">
      {/* ── Filter bar ────────────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">
        <DateRangePopover from={from} to={to} preset={preset} onPreset={(days) => setFilters((p) => ({ ...p, from: presetFrom(days), to: today(), preset: days }))} onCustom={() => setFilters((p) => ({ ...p, preset: undefined }))} onFromChange={(v) => setFilters((p) => ({ ...p, from: v, preset: undefined }))} onToChange={(v) => setFilters((p) => ({ ...p, to: v, preset: undefined }))} />
        <MultiselectCombobox options={nameList.data ?? []} selected={selectedNames} onChange={(v) => setFilters((p) => ({ ...p, names: v.length ? v : undefined }))} placeholder="All traces" />
        <MultiselectCombobox options={envList.data ?? []} selected={selectedEnvs} onChange={(v) => setFilters((p) => ({ ...p, env: v.length ? v : undefined }))} placeholder="All environments" />
        <MultiselectCombobox options={modelList.data ?? []} selected={selectedModels} onChange={(v) => setFilters((p) => ({ ...p, models: v.length ? v : undefined }))} placeholder="All models" />
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
          className="border-l border-zinc-800"
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

    </main>
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



function formatTokens(n: number): string {
  if (n === 0) return "0";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
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
