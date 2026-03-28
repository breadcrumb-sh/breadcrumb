import { Select } from "@base-ui/react/select";
import { CaretDown } from "@phosphor-icons/react/CaretDown";
import { Check } from "@phosphor-icons/react/Check";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  DateRangePopover,
  presetFrom,
  today,
} from "../common/DateRangePopover";
import { MultiselectCombobox } from "../common/MultiselectCombobox";
import { useProjectFilters } from "../../hooks/useProjectFilters";
import { DataTable, type Column, type SortState } from "../common/DataTable";
import { ChartSkeleton } from "../common/ChartSkeleton";
import { trpc } from "../../lib/trpc";
import { ChartCard } from "../overview/ChartCard";
import { TopFailingSpansTable } from "../overview/TopFailingSpansTable";
import { TraceQualityChart } from "../overview/TraceQualityChart";

const EMPTY_STRINGS: string[] = [];

// ── Span stats types & helpers ──────────────────────────────────────────────

type SampleSpan = {
  id: string;
  traceId: string;
  parentSpanId: string;
  name: string;
  type: string;
  status: "ok" | "error";
  startTime: string;
  endTime: string;
};

type SpanStats = {
  name: string;
  type: string;
  frequency: number;
  totalTraces: number;
  avgCount: number;
  avgDurationMs: number;
  p95DurationMs: number;
  errorRate: number;
};

function flowMs(chDate: string): number {
  return new Date(chDate.replace(" ", "T") + "Z").getTime();
}

function flowFmt(ms: number): string {
  if (!ms || ms < 0) return "\u2014";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function computeSpanStats(
  spans: SampleSpan[],
  totalTraces: number,
): SpanStats[] {
  const groups = new Map<string, { byTrace: Set<string>; all: SampleSpan[] }>();
  for (const s of spans) {
    const key = `${s.name}\0${s.type}`;
    if (!groups.has(key)) groups.set(key, { byTrace: new Set(), all: [] });
    const g = groups.get(key)!;
    g.byTrace.add(s.traceId);
    g.all.push(s);
  }
  return Array.from(groups.values())
    .map((g) => {
      const durations = g.all.map(
        (s) => flowMs(s.endTime) - flowMs(s.startTime),
      );
      const errors = g.all.filter((s) => s.status === "error").length;
      return {
        name: g.all[0].name,
        type: g.all[0].type,
        frequency: g.byTrace.size,
        totalTraces,
        avgCount: g.all.length / g.byTrace.size,
        avgDurationMs: durations.reduce((s, d) => s + d, 0) / durations.length,
        p95DurationMs: percentile(durations, 95),
        errorRate: errors / g.all.length,
      };
    })
    .sort((a, b) => b.frequency - a.frequency);
}

const STAT_TYPE_CLASSES: Record<string, string> = {
  llm: "text-purple-400 bg-purple-400/10 border-purple-400/20",
  tool: "text-blue-400 bg-blue-400/10 border-blue-400/20",
  retrieval: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20",
};

const SPAN_STATS_COLUMNS: Column<SpanStats>[] = [
  {
    key: "name",
    header: "Span",
    sortable: true,
    render: (s) => <span className="text-zinc-100 font-medium">{s.name}</span>,
  },
  {
    key: "type",
    header: "Type",
    sortable: true,
    render: (s) => {
      if (s.type === "custom") return <span className="text-zinc-500 text-[10px]">—</span>;
      const tc =
        STAT_TYPE_CLASSES[s.type] ??
        "text-zinc-400 bg-zinc-400/10 border-zinc-400/20";
      return (
        <span
          className={`inline-flex items-center rounded border px-1.5 py-[2px] text-[10px] font-medium leading-none ${tc}`}
        >
          {s.type}
        </span>
      );
    },
  },
  {
    key: "frequency",
    header: "Frequency",
    align: "right",
    sortable: true,
    render: (s) => {
      const freqPct = Math.round((s.frequency / (s.totalTraces || 1)) * 100);
      return (
        <span className="text-zinc-400 tabular-nums">
          {freqPct}%
          <span className="text-zinc-600 ml-1 text-xs">
            ({s.frequency}/{s.totalTraces})
          </span>
        </span>
      );
    },
  },
  {
    key: "avgCount",
    header: "Avg #",
    align: "right",
    sortable: true,
    render: (s) => (
      <span className="text-zinc-400 tabular-nums">
        {s.avgCount.toFixed(1)}
      </span>
    ),
  },
  {
    key: "avgDurationMs",
    header: "Avg Duration",
    align: "right",
    sortable: true,
    render: (s) => (
      <span className="text-zinc-400 tabular-nums">
        {flowFmt(s.avgDurationMs)}
      </span>
    ),
  },
  {
    key: "p95DurationMs",
    header: "p95 Duration",
    align: "right",
    sortable: true,
    render: (s) => (
      <span className="text-zinc-400 tabular-nums">
        {flowFmt(s.p95DurationMs)}
      </span>
    ),
  },
  {
    key: "errorRate",
    header: "Error Rate",
    align: "right",
    sortable: true,
    render: (s) => {
      const errPct = Math.round(s.errorRate * 100);
      return (
        <span
          className={`tabular-nums ${errPct > 0 ? "text-red-400" : "text-zinc-600"}`}
        >
          {errPct}%
        </span>
      );
    },
  },
];

// ── Chart helpers ───────────────────────────────────────────────────────────

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


// ── Component ───────────────────────────────────────────────────────────────

const route = createFileRoute("/_authed/projects/$projectId/traces")();

export function ReliabilitySection() {
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

  const daily = trpc.traces.dailyMetrics.useQuery(commonFilters);
  const quality = trpc.traces.qualityTimeline.useQuery(commonFilters);
  const failingSpans = trpc.traces.topFailingSpans.useQuery(commonFilters);
  const envList = trpc.traces.environments.useQuery({ projectId });
  const modelList = trpc.traces.models.useQuery({ projectId });
  const nameList = trpc.traces.names.useQuery({ projectId });

  // ── Span statistics (own trace selector, independent of page filters) ───

  const [spanTraceName, setSpanTraceName] = useState("");

  // Auto-select first available name
  useEffect(() => {
    if (nameList.data?.length && !spanTraceName) {
      setSpanTraceName(nameList.data[0]);
    }
  }, [nameList.data, spanTraceName]);

  const spansQuery = trpc.traces.spanSample.useQuery(
    { projectId, traceName: spanTraceName, from, to },
    { enabled: !!spanTraceName, placeholderData: (prev) => prev },
  );

  const { spanStats, traceCount } = useMemo(() => {
    if (!spansQuery.data?.spans?.length)
      return { spanStats: [] as SpanStats[], traceCount: 0 };

    return {
      spanStats: computeSpanStats(spansQuery.data.spans, spansQuery.data.traceCount),
      traceCount: spansQuery.data.traceCount,
    };
  }, [spansQuery.data]);

  const [spanSort, setSpanSort] = useState<SortState | null>(null);

  const sortedStats = useMemo(() => {
    if (!spanSort) return spanStats;
    const { key, dir } = spanSort;
    const sorted = [...spanStats].sort((a, b) => {
      const av = a[key as keyof SpanStats];
      const bv = b[key as keyof SpanStats];
      if (typeof av === "string" && typeof bv === "string")
        return av.localeCompare(bv);
      return (av as number) - (bv as number);
    });
    return dir === "desc" ? sorted.reverse() : sorted;
  }, [spanStats, spanSort]);

  const spanStatsLoading = !!spanTraceName && spansQuery.isLoading;

  return (
    <div className="space-y-6">
      {/* ── Filter bar ────────────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">
        <DateRangePopover from={from} to={to} preset={preset} onPreset={(days) => setFilters((p) => ({ ...p, from: presetFrom(days), to: today(), preset: days }))} onCustom={() => setFilters((p) => ({ ...p, preset: undefined }))} onFromChange={(v) => setFilters((p) => ({ ...p, from: v, preset: undefined }))} onToChange={(v) => setFilters((p) => ({ ...p, to: v, preset: undefined }))} />
        <MultiselectCombobox options={nameList.data ?? []} selected={selectedNames} onChange={(v) => setFilters((p) => ({ ...p, names: v.length ? v : undefined }))} placeholder="All traces" />
        <MultiselectCombobox options={envList.data ?? []} selected={selectedEnvs} onChange={(v) => setFilters((p) => ({ ...p, env: v.length ? v : undefined }))} placeholder="All environments" />
        <MultiselectCombobox options={modelList.data ?? []} selected={selectedModels} onChange={(v) => setFilters((p) => ({ ...p, models: v.length ? v : undefined }))} placeholder="All models" />
      </div>


      {/* ── Trace Quality ─────────────────────────────────────── */}
      <TraceQualityChart
        data={quality.data}
        loading={quality.isLoading}
        from={from}
        to={to}
      />

      {/* ── Charts ───────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <ChartCard
          label="Success rate"
          data={fillDays(daily.data ?? [], from, to, (r) => r.date, (r) =>
            r && r.traces > 0 ? ((r.traces - r.errors) / r.traces) * 100 : 100,
          )}
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

      {/* ── Span Statistics ──────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
            Span Statistics
          </h3>
          <Select.Root
            value={spanTraceName}
            onValueChange={(v) => v && setSpanTraceName(v)}
            disabled={!nameList.data?.length}
          >
            <Select.Trigger className="h-[30px] flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-2.5 text-xs text-zinc-400 outline-none hover:border-zinc-700 focus:border-zinc-600 cursor-pointer transition-colors min-w-[120px] max-w-[200px]">
              <Select.Value placeholder="No traces yet" className="truncate flex-1 text-left" />
              <Select.Icon>
                <CaretDown size={12} className="text-zinc-500" />
              </Select.Icon>
            </Select.Trigger>
            <Select.Portal>
              <Select.Positioner sideOffset={4} className="z-[100]">
                <Select.Popup className="rounded-lg border border-zinc-800 bg-zinc-900 py-1 shadow-xl max-h-[240px] overflow-y-auto min-w-[var(--anchor-width)] motion-preset-fade motion-preset-slide-down-sm motion-duration-150">
                  {nameList.data?.map((name) => (
                    <Select.Item
                      key={name}
                      value={name}
                      className="flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-400 outline-none cursor-default data-[highlighted]:bg-zinc-800 data-[highlighted]:text-zinc-100 transition-colors"
                    >
                      <Select.ItemIndicator className="w-3">
                        <Check size={10} />
                      </Select.ItemIndicator>
                      <Select.ItemText>{name}</Select.ItemText>
                    </Select.Item>
                  ))}
                </Select.Popup>
              </Select.Positioner>
            </Select.Portal>
          </Select.Root>
        </div>
        {spanStatsLoading ? (
          <div className="rounded-md border border-zinc-800" style={{ height: 280 }}>
            <ChartSkeleton variant="table" rows={5} />
          </div>
        ) : sortedStats.length > 0 ? (
          <DataTable
            columns={SPAN_STATS_COLUMNS}
            data={sortedStats}
            rowKey={(s) => `${s.name}-${s.type}`}
            sort={spanSort}
            onSortChange={setSpanSort}
          />
        ) : (
          <p className="text-sm text-zinc-500 py-8 text-center">
            No span data available.
          </p>
        )}
      </div>
    </div>
  );
}
