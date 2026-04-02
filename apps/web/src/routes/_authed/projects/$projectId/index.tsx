import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { z } from "zod";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
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
import { KanbanBoard } from "../../../../components/monitor/KanbanBoard";
import { ScanHistorySheet } from "../../../../components/monitor/ScanHistorySheet";

const searchSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  preset: z.union([z.literal(7), z.literal(30), z.literal(90)]).optional(),
  names: z.array(z.string()).optional(),
  models: z.array(z.string()).optional(),
  env: z.array(z.string()).optional(),
  item: z.string().optional(),
});

export const Route = createFileRoute("/_authed/projects/$projectId/")({
  validateSearch: searchSchema,
  component: OverviewPage,
});

const EMPTY_STRINGS: string[] = [];

function OverviewPage() {
  usePageView("overview");
  const { projectId } = Route.useParams();
  const { item: selectedItemId } = Route.useSearch();
  const navigate = Route.useNavigate();
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
  const quality = trpc.traces.qualityTimeline.useQuery(commonFilters);
  const envList = trpc.traces.environments.useQuery({ projectId });
  const modelList = trpc.traces.models.useQuery({ projectId });
  const nameList = trpc.traces.names.useQuery({ projectId });

  const statsRef = useRef<HTMLDivElement>(null);

  const sparklineDays = useMemo(() => {
    const raw = quality.data?.days ?? [];
    if (!raw.length) return [];
    const map = new Map(raw.map((d) => [d.date, d]));
    const filled: Array<{ date: string; total: number }> = [];
    const start = new Date(from + "T00:00:00Z");
    const end = new Date(to + "T00:00:00Z");
    for (const d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const key = d.toISOString().slice(0, 10);
      const row = map.get(key);
      filled.push({ date: key, total: row ? row.healthy + row.expensive + row.failed : 0 });
    }
    return filled;
  }, [quality.data?.days, from, to]);

  return (
    <div className="flex flex-col">
      <div className="px-5 pt-6 pb-0 sm:px-8 sm:pt-8 space-y-6 w-full page-container-small shrink-0">
      {/* ── Filter bar ────────────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">
        <DateRangePopover from={from} to={to} preset={preset} onPreset={(days) => setFilters((p) => ({ ...p, from: presetFrom(days), to: today(), preset: days }))} onCustom={() => setFilters((p) => ({ ...p, preset: undefined }))} onFromChange={(v) => setFilters((p) => ({ ...p, from: v, preset: undefined }))} onToChange={(v) => setFilters((p) => ({ ...p, to: v, preset: undefined }))} />
        <MultiselectCombobox options={nameList.data ?? []} selected={selectedNames} onChange={(v) => setFilters((p) => ({ ...p, names: v.length ? v : undefined }))} placeholder="All traces" />
        <MultiselectCombobox options={envList.data ?? []} selected={selectedEnvs} onChange={(v) => setFilters((p) => ({ ...p, env: v.length ? v : undefined }))} placeholder="All environments" />
        <MultiselectCombobox options={modelList.data ?? []} selected={selectedModels} onChange={(v) => setFilters((p) => ({ ...p, models: v.length ? v : undefined }))} placeholder="All models" />
      </div>

      {/* ── Stat cards ────────────────────────────────────────── */}
      <div ref={statsRef} className="rounded-lg border border-zinc-800 bg-zinc-900 grid grid-cols-2 sm:grid-cols-5">
        {/* Traces sparkline cell */}
        <div className="px-5 py-4 space-y-2">
          <p className="text-xs text-zinc-500">Traces</p>
          <div className="flex items-end gap-3">
            <p className={`text-2xl font-semibold tracking-tight tabular-nums ${stats.isLoading ? "text-zinc-700 animate-pulse" : "text-zinc-100"}`}>
              {stats.isLoading ? "———" : stats.data?.traceCount.toLocaleString() ?? "-"}
            </p>
            {sparklineDays.length > 0 && (
              <div className="flex-1 h-10 min-w-0 -mb-1">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={sparklineDays} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
                    <defs>
                      <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--color-viz-1)" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="var(--color-viz-1)" stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <Area dataKey="total" stroke="var(--color-viz-1)" strokeWidth={1.5} fill="url(#sparkFill)" isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>
        <StatCell
          className="border-l border-zinc-800"
          label="Total cost"
          value={stats.data ? formatCost(stats.data.totalCostUsd) : "-"}
          loading={stats.isLoading}
          delta={pctChange(
            stats.data?.totalCostUsd,
            stats.data?.prev?.totalCostUsd,
          )}
        />
        <StatCell
          className="border-t sm:border-t-0 sm:border-l border-zinc-800"
          label="Tokens"
          value={stats.data ? formatTokens(stats.data.totalTokens) : "-"}
          loading={stats.isLoading}
          delta={pctChange(
            stats.data?.totalTokens,
            stats.data?.prev?.totalTokens,
          )}
        />
        <StatCell
          className="border-t border-l sm:border-t-0 sm:border-l border-zinc-800"
          label="Avg duration"
          value={stats.data ? formatDuration(stats.data.avgDurationMs) : "-"}
          loading={stats.isLoading}
          delta={pctChange(
            stats.data?.avgDurationMs,
            stats.data?.prev?.avgDurationMs,
          )}
        />
        <StatCell
          className="border-t sm:border-t-0 sm:border-l border-zinc-800 col-span-2 sm:col-span-1"
          label="Error rate"
          value={stats.data ? formatErrorRate(stats.data.errorRate) : "-"}
          loading={stats.isLoading}
          delta={pctChange(stats.data?.errorRate, stats.data?.prev?.errorRate)}
        />
      </div>

      <MonitorSummary projectId={projectId} from={from} to={to} />

      </div>
      {/* ── Agent monitoring board ────────────────────────────── */}
      <div className="pt-8 pb-4" style={{ height: "calc(100vh - 80px)" }}>
        <KanbanBoard
          projectId={projectId}
          alignRef={statsRef}
          selectedItemId={selectedItemId}
          onSelectItem={(id) => navigate({ search: (prev) => ({ ...prev, item: id ?? undefined }), replace: true })}
        />
      </div>
    </div>
  );
}

// ── Monitor summary ─────────────────────────────────────────────────────────

function MonitorSummary({ projectId, from, to }: { projectId: string; from: string; to: string }) {
  const utils = trpc.useUtils();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [justTriggered, setJustTriggered] = useState(false);
  const lastRunAgoMs = (run: { startedAt: string } | null) =>
    run ? Date.now() - new Date(run.startedAt).getTime() : Infinity;
  const summary = trpc.monitor.summary.useQuery({ projectId, from, to }, {
    refetchInterval: (query) => {
      const r = query.state.data?.lastRun;
      // Poll quickly after manual trigger until we see the running state
      if (justTriggered) return 500;
      if (!r) return false;
      if (r.status === "running") return 5_000;
      return lastRunAgoMs(r) < 10 * 60 * 1000 ? 60_000 : false;
    },
  });
  const triggerScan = trpc.monitor.triggerScan.useMutation({
    onSuccess: () => setJustTriggered(true),
  });

  // Clear justTriggered once we see a running or recent scan
  if (justTriggered && summary.data?.lastRun) {
    const r = summary.data.lastRun;
    if (r.status === "running" || lastRunAgoMs(r) < 10_000) {
      setJustTriggered(false);
    }
  }
  const d = summary.data;
  if (!d) return null;
  const isRunning = d.lastRun?.status === "running" || justTriggered;

  if (d.traceCount === 0) {
    return (
      <p className="text-2xl max-w-4xl mt-12 text-pretty font-medium text-muted-foreground">
        No traces in this period. I'm ready and will start monitoring as soon as traces come in.
      </p>
    );
  }

  const sentences: React.ReactNode[] = [];

  // Trace count
  sentences.push(
    <span key="traces">
      Across <span className="text-foreground">{d.traceCount.toLocaleString()} traces</span> in this period
      {d.issuesFound > 0
        ? <>, I found <span className="text-foreground">{d.issuesFound} {d.issuesFound === 1 ? "issue" : "issues"}</span></>
        : <>, I found no issues</>
      }.
    </span>,
  );

  // Review + closed
  const statusParts: React.ReactNode[] = [];
  if (d.needsReview > 0) {
    statusParts.push(<span key="review"><span className="text-foreground">{d.needsReview}</span> {d.needsReview === 1 ? "item needs" : "items need"} your review</span>);
  }
  if (d.resolved > 0) {
    statusParts.push(<span key="resolved"><span className="text-foreground">{d.resolved}</span> {d.resolved === 1 ? "was" : "were"} resolved</span>);
  }
  if (statusParts.length > 0) {
    sentences.push(
      <span key="status">
        {statusParts.map((part, i) => (
          <span key={i}>{i > 0 && ", "}{part}</span>
        ))}.
      </span>,
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-2xl max-w-4xl mt-12 text-pretty font-medium text-muted-foreground">
        {sentences.map((s, i) => (
          <span key={i}>
            {i > 0 && <br />}
            {s}
          </span>
        ))}
      </p>
      <p className="text-muted-foreground text-sm">
        {d.lastRun ? (
          <>
            Last check {formatTimeAgo(d.lastRun.startedAt)}
            {d.lastRun.status === "running" && ", running..."}
            {d.lastRun.status === "success" && `, found ${d.lastRun.ticketsCreated} new issue${d.lastRun.ticketsCreated === 1 ? "" : "s"}`}
            {d.lastRun.status === "empty" && ", no new issues"}
            {d.lastRun.status === "skipped" && ", skipped (budget limit)"}
            {d.lastRun.status === "error" && ", failed"}
            .
          </>
        ) : <>No checks run yet.</>}
        {" "}
        {isRunning ? (
          <button
            className="inline underline cursor-pointer"
            onClick={() => setHistoryOpen(true)}
          >
            View history
          </button>
        ) : (
          <>
            <button
              className="inline underline cursor-pointer"
              onClick={() => triggerScan.mutate({ projectId })}
            >
              Run check
            </button>
            {" or "}
            <button
              className="inline underline cursor-pointer"
              onClick={() => setHistoryOpen(true)}
            >
              view history
            </button>
          </>
        )}
      </p>
      <ScanHistorySheet projectId={projectId} open={historyOpen} onOpenChange={setHistoryOpen} />
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



function formatTokens(n: number): string {
  if (n === 0) return "0";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatDuration(ms: number): string {
  if (!ms || ms <= 0) return "-";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}


function formatTimeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "less than a minute ago";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatErrorRate(rate: number): string {
  if (rate === 0) return "0%";
  if (rate < 0.001) return "<0.1%";
  return `${(rate * 100).toFixed(1)}%`;
}
