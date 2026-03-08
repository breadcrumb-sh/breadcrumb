import { Tooltip } from "@base-ui/react/tooltip";
import { Pulse } from "@phosphor-icons/react";
import { getRouteApi } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import { CommonPathsChart } from "./CommonPathsChart";
import { ChartSkeleton } from "../ChartSkeleton";
import { InlineSelect } from "../InlineSelect";
import { DataTable, type Column, type SortState } from "../DataTable";
import {
  DateRangePopover,
  presetFrom,
  today,
} from "../DateRangePopover";
import { MultiselectCombobox } from "../MultiselectCombobox";
import { trpc } from "../../lib/trpc";

const route = getRouteApi("/_authed/projects/$projectId/traces");

// ── Types & helpers ──────────────────────────────────────────────────────────

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

function filterBySteps(
  spans: SampleSpan[],
  selectedStepNames: string[],
): SampleSpan[] {
  if (!selectedStepNames.length) return spans;

  const childrenOf = new Map<string, SampleSpan[]>();
  for (const s of spans) {
    const key = s.parentSpanId || "";
    if (!childrenOf.has(key)) childrenOf.set(key, []);
    childrenOf.get(key)!.push(s);
  }

  const keep = new Set<string>();

  const seeds = spans.filter(
    (s) => s.type === "step" && selectedStepNames.includes(s.name),
  );

  for (const stepSpan of seeds) {
    keep.add(stepSpan.id);

    const queue = [...(childrenOf.get(stepSpan.id) ?? [])];
    while (queue.length) {
      const child = queue.shift()!;
      if (child.type === "step") continue;
      keep.add(child.id);
      queue.push(...(childrenOf.get(child.id) ?? []));
    }
  }

  return spans.filter((s) => keep.has(s.id));
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

// ── Span Frequency Chart ──────────────────────────────────────────────────────

type FrequencyDatum = {
  name: string;
  type: string;
  p5: number;
  p50: number;
  p95: number;
  max: number;
};

function computeSpanFrequency(
  spans: SampleSpan[],
  totalTraces: number,
): FrequencyDatum[] {
  const leafSpans = spans.filter((s) => s.type !== "step");

  const byName = new Map<
    string,
    { type: string; perTrace: Map<string, number> }
  >();
  for (const s of leafSpans) {
    if (!byName.has(s.name))
      byName.set(s.name, { type: s.type, perTrace: new Map() });
    const entry = byName.get(s.name)!;
    entry.perTrace.set(s.traceId, (entry.perTrace.get(s.traceId) ?? 0) + 1);
  }

  return Array.from(byName.entries())
    .map(([name, { type, perTrace }]) => {
      const counts = Array.from(perTrace.values());
      const missingTraces = totalTraces - perTrace.size;
      for (let i = 0; i < missingTraces; i++) counts.push(0);

      return {
        name,
        type,
        p5: percentile(counts, 5),
        p50: percentile(counts, 50),
        p95: percentile(counts, 95),
        max: Math.max(...counts),
      };
    })
    .sort((a, b) => b.p95 - a.p95 || b.p50 - a.p50);
}

const FREQ_TOOLTIP_CLS =
  "rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-[11px] text-zinc-300 shadow-lg max-w-[220px]";

const FREQ_COLORS = {
  p5: "var(--color-viz-1)",
  p50: "var(--color-viz-5)",
  p95: "var(--color-viz-7)",
} as const;

function FrequencyTooltipContent(props: {
  active?: boolean;
  payload?: Array<{
    name?: string;
    value?: number;
    color?: string;
    payload?: FrequencyDatum;
  }>;
}) {
  const { active, payload } = props;
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <div className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 shadow-lg space-y-1">
      <div className="font-medium text-zinc-400">
        {d.name} <span className="text-zinc-500">({d.type})</span>
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
          <span className="tabular-nums text-zinc-300">{p.value}</span>
        </div>
      ))}
    </div>
  );
}

function LegendChip({
  color,
  label,
  tooltip,
}: {
  color: string;
  label: string;
  tooltip: string;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-[10px] text-zinc-400 cursor-default"
        render={<span />}
      >
        <span
          className="inline-block w-2 h-2 rounded-full shrink-0"
          style={{ backgroundColor: color }}
        />
        {label}
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Positioner sideOffset={6}>
          <Tooltip.Popup className={FREQ_TOOLTIP_CLS}>{tooltip}</Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

function SpanFrequencyChart({
  spans,
  totalTraces,
}: {
  spans: SampleSpan[];
  totalTraces: number;
}) {
  const data = useMemo(
    () => computeSpanFrequency(spans, totalTraces),
    [spans, totalTraces],
  );

  if (!data.length) return null;

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-5 pt-5 pb-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-zinc-500">
          Span frequency per trace
        </p>
        <div className="flex flex-wrap gap-1.5">
          <LegendChip
            color={FREQ_COLORS.p5}
            label="p5"
            tooltip="5th percentile — the low end. If this is 0, at least 5% of traces never ran this span at all."
          />
          <LegendChip
            color={FREQ_COLORS.p50}
            label="p50"
            tooltip="Median count per trace. This is how many times the span typically runs in a single trace."
          />
          <LegendChip
            color={FREQ_COLORS.p95}
            label="p95"
            tooltip="95th percentile — the high end. If this is much larger than p50, some traces run this span far more often than usual."
          />
        </div>
      </div>

      <div style={{ height: 280 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
            barGap={2}
            barCategoryGap="30%"
          >
            <CartesianGrid
              vertical={false}
              stroke="var(--color-zinc-800)"
              strokeDasharray="3 3"
            />
            <XAxis
              dataKey="name"
              tick={{ fill: "var(--color-zinc-500)", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fill: "var(--color-zinc-500)", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
              width={36}
            />
            <RechartsTooltip
              animationDuration={150}
              content={FrequencyTooltipContent}
              cursor={{ fill: "var(--color-zinc-800)", opacity: 0.3 }}
            />
            <Bar
              dataKey="p5"
              name="p5"
              fill={FREQ_COLORS.p5}
              radius={[3, 3, 0, 0]}
              isAnimationActive={false}
            />
            <Bar
              dataKey="p50"
              name="p50"
              fill={FREQ_COLORS.p50}
              radius={[3, 3, 0, 0]}
              isAnimationActive={false}
            />
            <Bar
              dataKey="p95"
              name="p95"
              fill={FREQ_COLORS.p95}
              radius={[3, 3, 0, 0]}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ── Loopback Chart ────────────────────────────────────────────────────────────

type LoopbackSpan = {
  name: string;
  type: string;
  appearances: number;
  loopbacks: number;
  rate: number;
  triggers: Array<{ name: string; pct: number }>;
};

function LoopbackTooltipContent(props: {
  active?: boolean;
  payload?: Array<{ payload?: LoopbackSpan }>;
}) {
  const { active, payload } = props;
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  const topTriggers = d.triggers.slice(0, 5);
  return (
    <div className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 shadow-lg space-y-1.5 max-w-[260px]">
      <div className="font-medium text-zinc-400">
        {d.name} <span className="text-zinc-500">({d.type})</span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-zinc-500">Loopback rate</span>
        <span className="tabular-nums text-viz-1">
          {(d.rate * 100).toFixed(1)}%
        </span>
      </div>
      <div className="flex justify-between gap-4">
        <span className="text-zinc-500">Loopbacks / appearances</span>
        <span className="tabular-nums text-zinc-300">
          {d.loopbacks} / {d.appearances}
        </span>
      </div>
      {topTriggers.length > 0 && (
        <>
          <div className="border-t border-zinc-800 pt-1.5 text-[10px] text-zinc-500 uppercase tracking-wide">
            Top triggers
          </div>
          {topTriggers.map((t) => (
            <div key={t.name} className="flex justify-between gap-3">
              <span className="text-zinc-300 truncate">{t.name}</span>
              <span className="tabular-nums text-zinc-500 shrink-0">
                {(t.pct * 100).toFixed(0)}%
              </span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function LoopbackChart({
  projectId,
  traceName,
  from,
  to,
}: {
  projectId: string;
  traceName: string;
  from?: string;
  to?: string;
}) {
  const [sortBy, setSortBy] = useState<"rate" | "loopbacks">("rate");

  const query = trpc.traces.loopbackRate.useQuery(
    { projectId, traceName, from, to, sortBy },
    { enabled: !!traceName },
  );

  if (query.isLoading && traceName) {
    return (
      <div
        className="rounded-lg border border-zinc-800 bg-zinc-900"
        style={{ height: 340 }}
      >
        <ChartSkeleton variant="bar" />
      </div>
    );
  }

  if (!query.data?.spans?.length) return null;

  const data = query.data.spans;

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-5 pt-5 pb-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <p className="text-xs font-medium text-zinc-500">Span loopback rate</p>
          <InlineSelect
            value={sortBy}
            onChange={setSortBy}
            options={[
              { value: "rate", label: "by rate" },
              { value: "loopbacks", label: "by count" },
            ]}
            size="xs"
          />
        </div>
        <LegendChip
          color="var(--color-viz-1)"
          label="Loopback"
          tooltip="A loopback is when a span disappears for one or more consecutive traces then reappears. Rate = loopbacks / total appearances."
        />
      </div>

      <div style={{ height: 280 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
            barCategoryGap="30%"
          >
            <CartesianGrid
              vertical={false}
              stroke="var(--color-zinc-800)"
              strokeDasharray="3 3"
            />
            <XAxis
              dataKey="name"
              tick={{ fill: "var(--color-zinc-500)", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fill: "var(--color-zinc-500)", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={40}
              tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
              domain={[
                0,
                (max: number) => Math.min(1, Math.ceil(max * 10) / 10 + 0.1),
              ]}
            />
            <RechartsTooltip
              animationDuration={150}
              content={LoopbackTooltipContent}
              cursor={{ fill: "var(--color-zinc-800)", opacity: 0.3 }}
            />
            <Bar
              dataKey="rate"
              name="Loopback rate"
              fill="var(--color-viz-1)"
              radius={[3, 3, 0, 0]}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ── Insights Section ──────────────────────────────────────────────────────────

export function InsightsSection() {
  const { projectId } = route.useParams();
  const navigate = route.useNavigate();
  const search = route.useSearch();

  const from = search.from ?? presetFrom(30);
  const to = search.to ?? today();
  const preset = search.preset ?? 30;
  const selectedNames = search.names ?? [];
  const selectedStatuses = search.statuses ?? [];
  const selectedSteps = search.steps ?? [];

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
    navigate({
      search: (prev) => ({ ...prev, from: v, preset: undefined }),
    });
  const handleToChange = (v: string) =>
    navigate({
      search: (prev) => ({ ...prev, to: v, preset: undefined }),
    });

  const nameList = trpc.traces.names.useQuery({ projectId });

  const activeName = selectedNames[0] ?? "";

  // Auto-select first available name
  useEffect(() => {
    if (nameList.data?.length && !activeName) {
      navigate({
        search: (prev) => ({ ...prev, names: [nameList.data![0]] }),
        replace: true,
      });
    }
  }, [nameList.data, activeName, navigate]);

  const spansQuery = trpc.traces.spanSample.useQuery(
    { projectId, traceName: activeName, from, to },
    { enabled: !!activeName },
  );

  // Distinct step span names available in the data
  const stepNames = useMemo(() => {
    if (!spansQuery.data?.spans?.length) return [];
    const names = new Set<string>();
    for (const s of spansQuery.data.spans) {
      if (s.type === "step") names.add(s.name);
    }
    return Array.from(names).sort();
  }, [spansQuery.data]);

  const { stats, rawSpans, traceCount } = useMemo(() => {
    if (!spansQuery.data?.spans?.length)
      return {
        stats: [] as SpanStats[],
        rawSpans: [] as SampleSpan[],
        traceCount: 0,
      };

    const { spans } = spansQuery.data;

    // Apply step filter first (structural, prunes subtrees)
    const afterSteps = filterBySteps(spans, selectedSteps);

    // Client-side status filter
    const filtered =
      selectedStatuses.length > 0
        ? afterSteps.filter((s: SampleSpan) =>
            selectedStatuses.includes(s.status),
          )
        : afterSteps;

    // Trace count = unique traces that still have spans after filtering
    const traceIds = new Set(filtered.map((s) => s.traceId));
    const count =
      selectedSteps.length > 0 ? traceIds.size : spansQuery.data.traceCount;

    const spanStats = computeSpanStats(filtered, count);

    return {
      stats: spanStats,
      rawSpans: filtered,
      traceCount: count,
    };
  }, [spansQuery.data, selectedStatuses, selectedSteps]);

  const isLoading =
    nameList.isLoading || (!!activeName && spansQuery.isLoading);

  const [spanSort, setSpanSort] = useState<SortState | null>(null);

  const sortedStats = useMemo(() => {
    if (!spanSort) return stats;
    const { key, dir } = spanSort;
    const sorted = [...stats].sort((a, b) => {
      const av = a[key as keyof SpanStats];
      const bv = b[key as keyof SpanStats];
      if (typeof av === "string" && typeof bv === "string")
        return av.localeCompare(bv);
      return (av as number) - (bv as number);
    });
    return dir === "desc" ? sorted.reverse() : sorted;
  }, [stats, spanSort]);


  return (
    <div className="space-y-6">
      {/* ── Filter bar ────────────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">
        <DateRangePopover
          from={from}
          to={to}
          preset={preset}
          onPreset={applyPreset}
          onCustom={() =>
            navigate({
              search: (prev) => ({ ...prev, preset: undefined }),
            })
          }
          onFromChange={handleFromChange}
          onToChange={handleToChange}
        />

        <div className="h-4 w-px bg-zinc-800" />

        <select
          value={activeName}
          onChange={(e) =>
            navigate({
              search: (prev) => ({
                ...prev,
                names: e.target.value ? [e.target.value] : undefined,
                steps: undefined,
              }),
            })
          }
          disabled={!nameList.data?.length}
          className="h-[30px] rounded-md border border-zinc-800 bg-zinc-900 px-2.5 text-xs text-zinc-300 outline-none focus:border-zinc-600 cursor-pointer"
        >
          {!nameList.data?.length && <option value="">No traces yet</option>}
          {nameList.data?.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>

        <MultiselectCombobox
          options={stepNames}
          selected={selectedSteps}
          onChange={(v) =>
            navigate({
              search: (prev) => ({
                ...prev,
                steps: v.length ? v : undefined,
              }),
            })
          }
          placeholder="All steps"
        />

        <MultiselectCombobox
          options={["ok", "error"]}
          selected={selectedStatuses}
          onChange={(v) =>
            navigate({
              search: (prev) => ({
                ...prev,
                statuses: v.length ? (v as ("ok" | "error")[]) : undefined,
              }),
            })
          }
          placeholder="All statuses"
        />
      </div>

      {isLoading ? (
        <div className="space-y-6">
          <div
            className="rounded-lg border border-zinc-800 bg-zinc-900"
            style={{ height: 340 }}
          >
            <ChartSkeleton variant="bar" />
          </div>
          <div
            className="rounded-md border border-zinc-800"
            style={{ height: 280 }}
          >
            <ChartSkeleton variant="table" rows={5} />
          </div>
        </div>
      ) : !rawSpans.length ? (
        <div className="flex flex-col items-center justify-center border border-dashed border-zinc-700 py-24 text-center">
          <Pulse size={32} className="text-zinc-600 mb-3" />
          <p className="text-sm text-zinc-400">No trace data</p>
          <p className="mt-1 text-xs text-zinc-500">
            Select a trace name to see span insights.
          </p>
        </div>
      ) : (
        <>
          <CommonPathsChart spans={rawSpans} traceCount={traceCount} />
          <SpanFrequencyChart spans={rawSpans} totalTraces={traceCount} />
          <LoopbackChart
            projectId={projectId}
            traceName={activeName}
            from={from}
            to={to}
          />
          <div>
            <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-3">
              Span Statistics
            </h3>
            <DataTable
              columns={SPAN_STATS_COLUMNS}
              data={sortedStats}
              rowKey={(s) => `${s.name}-${s.type}`}
              sort={spanSort}
              onSortChange={setSpanSort}
            />
          </div>
        </>
      )}
    </div>
  );
}
