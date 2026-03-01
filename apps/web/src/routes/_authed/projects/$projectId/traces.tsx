import { Tooltip } from "@base-ui/react/tooltip";
import {
  CheckCircle,
  MagnifyingGlass,
  Pulse,
  SpinnerGap,
  SquaresFourIcon,
  Table,
  XCircle,
} from "@phosphor-icons/react";
import { createFileRoute } from "@tanstack/react-router";
import "@xyflow/react/dist/style.css";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import { z } from "zod";
import {
  DateRangePopover,
  presetFrom,
  today,
} from "../../../../components/DateRangePopover";
import { MultiselectCombobox } from "../../../../components/MultiselectCombobox";
import { useToastManager } from "../../../../components/Toasts";
import { TraceFlowGraph } from "../../../../components/TraceFlowGraph";
import { trpc } from "../../../../lib/trpc";

type Section = "overview" | "raw";

const searchSchema = z.object({
  tab: z.enum(["overview", "raw"]).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  preset: z.union([z.literal(7), z.literal(30), z.literal(90)]).optional(),
  names: z.array(z.string()).optional(),
  models: z.array(z.string()).optional(),
  statuses: z.array(z.enum(["ok", "error"])).optional(),
  env: z.array(z.string()).optional(),
  q: z.string().optional(),
});

export const Route = createFileRoute("/_authed/projects/$projectId/traces")({
  validateSearch: searchSchema,
  component: TracesPage,
});

const SIDEBAR_ITEMS: { id: Section; label: string; icon: React.ReactNode }[] = [
  { id: "overview", label: "Overview", icon: <SquaresFourIcon size={16} /> },
  { id: "raw", label: "Raw Traces", icon: <Table size={16} /> },
];

function TracesPage() {
  const navigate = Route.useNavigate();
  const { tab } = Route.useSearch();
  const section: Section = tab ?? "overview";

  const setSection = (next: Section) => {
    navigate({
      search: { tab: next },
      replace: true,
    });
  };

  return (
    <main className="px-5 py-6 sm:px-8 sm:py-8">
      <div className="flex gap-8">
        <nav className="w-44 shrink-0 space-y-0.5">
          {SIDEBAR_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => setSection(item.id)}
              className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
                section === item.id
                  ? "bg-zinc-800 text-zinc-100 font-medium"
                  : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>

        <div className="flex-1 min-w-0">
          {section === "overview" && <InsightsSection />}
          {section === "raw" && <RawTracesSection />}
        </div>
      </div>
    </main>
  );
}

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

// ── Span Stats Table ──────────────────────────────────────────────────────────

const STAT_TYPE_CLASSES: Record<string, string> = {
  llm: "text-purple-400 bg-purple-400/10 border-purple-400/20",
  tool: "text-blue-400 bg-blue-400/10 border-blue-400/20",
  retrieval: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20",
};

function SpanStatsTable({ stats }: { stats: SpanStats[] }) {
  if (!stats.length) return null;
  return (
    <div className="border border-zinc-800 overflow-hidden rounded-lg">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-800 bg-zinc-900/50">
            <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500">
              Span
            </th>
            <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500">
              Type
            </th>
            <th className="px-4 py-2.5 text-right text-xs font-medium text-zinc-500">
              Frequency
            </th>
            <th className="px-4 py-2.5 text-right text-xs font-medium text-zinc-500">
              Avg #
            </th>
            <th className="px-4 py-2.5 text-right text-xs font-medium text-zinc-500">
              Avg Duration
            </th>
            <th className="px-4 py-2.5 text-right text-xs font-medium text-zinc-500">
              p95 Duration
            </th>
            <th className="px-4 py-2.5 text-right text-xs font-medium text-zinc-500">
              Error Rate
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800">
          {stats.map((s) => {
            const freqPct = Math.round(
              (s.frequency / (s.totalTraces || 1)) * 100,
            );
            const errPct = Math.round(s.errorRate * 100);
            const tc =
              STAT_TYPE_CLASSES[s.type] ??
              "text-zinc-400 bg-zinc-400/10 border-zinc-400/20";
            return (
              <tr key={`${s.name}-${s.type}`} className="hover:bg-zinc-900/50">
                <td className="px-4 py-2.5 text-zinc-100 font-medium">
                  {s.name}
                </td>
                <td className="px-4 py-2.5">
                  <span
                    className={`inline-flex items-center rounded border px-1.5 py-px text-[10px] font-medium leading-none ${tc}`}
                  >
                    {s.type}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right text-zinc-400 tabular-nums">
                  {freqPct}%
                  <span className="text-zinc-600 ml-1 text-xs">
                    ({s.frequency}/{s.totalTraces})
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right text-zinc-400 tabular-nums">
                  {s.avgCount.toFixed(1)}
                </td>
                <td className="px-4 py-2.5 text-right text-zinc-400 tabular-nums">
                  {flowFmt(s.avgDurationMs)}
                </td>
                <td className="px-4 py-2.5 text-right text-zinc-400 tabular-nums">
                  {flowFmt(s.p95DurationMs)}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  <span
                    className={errPct > 0 ? "text-red-400" : "text-zinc-600"}
                  >
                    {errPct}%
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

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

const FREQ_MARGIN = { top: 8, right: 16, bottom: 24, left: 4 };
const AXIS_TICK = { fill: "var(--color-zinc-500)", fontSize: 11 } as const;
const FREQ_TOOLTIP_CLS =
  "rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-[11px] text-zinc-300 shadow-lg max-w-[220px]";

function FrequencyTooltipContent(props: {
  active?: boolean;
  payload?: Array<{ payload?: FrequencyDatum }>;
}) {
  const { active, payload } = props;
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <div className="rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100 shadow-lg space-y-0.5">
      <div className="font-medium">
        {d.name} <span className="text-zinc-500">({d.type})</span>
      </div>
      <div className="text-zinc-400">
        p5: {d.p5} &middot; p50: {d.p50} &middot; p95: {d.p95} &middot; max:{" "}
        {d.max}
      </div>
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
    <div className="space-y-2">
      <div
        className="border border-zinc-800 rounded-lg px-5 pt-4 pb-2"
        style={{ height: 240 }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={FREQ_MARGIN}
            barGap={2}
            barCategoryGap="30%"
          >
            <CartesianGrid vertical={false} stroke="var(--color-zinc-800)" />
            <XAxis
              dataKey="name"
              tick={{ fill: "var(--color-zinc-400)", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              interval={0}
              angle={-30}
              textAnchor="end"
              height={48}
            />
            <YAxis
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
              label={{
                value: "Count per trace",
                angle: -90,
                position: "insideLeft",
                offset: 8,
                fill: "var(--color-zinc-500)",
                fontSize: 11,
              }}
            />
            <RechartsTooltip
              animationDuration={150}
              content={FrequencyTooltipContent}
              cursor={{ fill: "var(--color-zinc-800)", opacity: 0.3 }}
            />
            <Bar
              dataKey="p5"
              name="p5"
              fill="var(--color-chart-7)"
              radius={[3, 3, 0, 0]}
              isAnimationActive={false}
            />
            <Bar
              dataKey="p50"
              name="p50"
              fill="var(--color-chart-2)"
              radius={[3, 3, 0, 0]}
              isAnimationActive={false}
            />
            <Bar
              dataKey="p95"
              name="p95"
              fill="var(--color-chart-4)"
              radius={[3, 3, 0, 0]}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      {/* Legend with tooltips */}
      <div className="flex flex-wrap gap-1.5">
        <LegendChip
          color="var(--color-chart-7)"
          label="p5"
          tooltip="5th percentile — the low end. If this is 0, at least 5% of traces never ran this span at all."
        />
        <LegendChip
          color="var(--color-chart-2)"
          label="p50"
          tooltip="Median count per trace. This is how many times the span typically runs in a single trace."
        />
        <LegendChip
          color="var(--color-chart-4)"
          label="p95"
          tooltip="95th percentile — the high end. If this is much larger than p50, some traces run this span far more often than usual."
        />
      </div>
    </div>
  );
}

// ── Insights Section ──────────────────────────────────────────────────────────

function InsightsSection() {
  const { projectId } = Route.useParams();
  const navigate = Route.useNavigate();
  const search = Route.useSearch();

  const from = search.from ?? presetFrom(30);
  const to = search.to ?? today();
  const preset = search.preset ?? 30;
  const selectedNames = search.names ?? [];
  const selectedStatuses = search.statuses ?? [];

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

  const sampleQuery = trpc.traces.spanSample.useQuery(
    { projectId, traceName: activeName, traceLimit: 50 },
    { enabled: !!activeName },
  );

  const happyPathQuery = trpc.traces.happyPath.useQuery(
    { projectId, traceName: activeName, traceLimit: 50 },
    { enabled: !!activeName },
  );

  const { stats, rawSpans, traceCount } = useMemo(() => {
    if (!sampleQuery.data?.spans?.length)
      return {
        stats: [] as SpanStats[],
        rawSpans: [] as SampleSpan[],
        traceCount: 0,
      };

    const { traceCount, spans } = sampleQuery.data;

    // Client-side status filter
    const filtered =
      selectedStatuses.length > 0
        ? spans.filter((s: SampleSpan) => selectedStatuses.includes(s.status))
        : spans;

    const spanStats = computeSpanStats(filtered, traceCount);

    return {
      stats: spanStats,
      rawSpans: filtered,
      traceCount,
    };
  }, [sampleQuery.data, selectedStatuses]);

  const isLoading =
    nameList.isLoading || (!!activeName && sampleQuery.isLoading);

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

        {sampleQuery.data && (
          <span className="text-[11px] text-zinc-600">
            Aggregated from {sampleQuery.data.traceCount} recent traces
          </span>
        )}
      </div>

      <div>
        <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-3">
          Execution Flow
        </h3>
        <TraceFlowGraph
          edges={happyPathQuery.data?.edges ?? []}
          totalTraces={happyPathQuery.data?.totalTraces ?? 0}
          isLoading={!!activeName && happyPathQuery.isLoading}
        />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center border border-dashed border-zinc-700 py-24">
          <SpinnerGap size={20} className="text-zinc-600 animate-spin" />
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
          <div>
            <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-3">
              Span Frequency per Trace
            </h3>
            <SpanFrequencyChart spans={rawSpans} totalTraces={traceCount} />
          </div>
          <div>
            <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-3">
              Span Statistics
            </h3>
            <SpanStatsTable stats={stats} />
          </div>
        </>
      )}
    </div>
  );
}

// ── Raw Traces Section ────────────────────────────────────────────────────────

function RawTracesSection() {
  const { projectId } = Route.useParams();
  const navigate = Route.useNavigate();
  const search = Route.useSearch();

  const from = search.from ?? presetFrom(30);
  const to = search.to ?? today();
  const preset = search.preset ?? 30;
  const selectedNames = search.names ?? [];
  const selectedModels = search.models ?? [];
  const selectedStatuses = search.statuses ?? [];
  const selectedEnvs = search.env ?? [];
  const nlpQuery = search.q ?? "";

  const [draft, setDraft] = useState(nlpQuery);

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
      search: (prev) => ({
        ...prev,
        from: v,
        preset: undefined,
      }),
    });
  const handleToChange = (v: string) =>
    navigate({
      search: (prev) => ({
        ...prev,
        to: v,
        preset: undefined,
      }),
    });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = draft.trim();
    navigate({
      search: (prev) => ({
        ...prev,
        q: trimmed || undefined,
      }),
    });
  };

  const clearSearch = () => {
    setDraft("");
    navigate({
      search: (prev) => ({
        ...prev,
        q: undefined,
      }),
    });
  };

  const traces = trpc.traces.list.useQuery({
    projectId,
    from,
    to,
    names: selectedNames.length > 0 ? selectedNames : undefined,
    models: selectedModels.length > 0 ? selectedModels : undefined,
    statuses:
      selectedStatuses.length > 0
        ? (selectedStatuses as ("ok" | "error")[])
        : undefined,
    environments: selectedEnvs.length > 0 ? selectedEnvs : undefined,
    query: nlpQuery || undefined,
  });

  const toastManager = useToastManager();
  const toastManagerRef = useRef(toastManager);
  toastManagerRef.current = toastManager;

  const searchMode = traces.data?.searchMode ?? null;
  const aiError = traces.data?.aiError ?? null;
  const lastToastedQuery = useRef<string | null>(null);

  useEffect(() => {
    if (searchMode !== "text" || !nlpQuery) return;
    if (lastToastedQuery.current === nlpQuery) return;
    lastToastedQuery.current = nlpQuery;

    if (aiError) {
      toastManagerRef.current.add({
        title: "AI search failed",
        description: aiError,
        data: {
          linkText: "Check AI settings",
          linkHref: `/projects/${projectId}/settings?tab=ai`,
        },
      });
    } else {
      const key = `ai-search-toast-dismissed:${projectId}`;
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, "1");
      toastManagerRef.current.add({
        title: "Using basic text search",
        description: "Configure an AI provider for smarter search.",
        data: {
          linkText: "Go to AI settings",
          linkHref: `/projects/${projectId}/settings?tab=ai`,
        },
      });
    }
  }, [searchMode, aiError, nlpQuery, projectId]);

  const envList = trpc.traces.environments.useQuery({ projectId });
  const modelList = trpc.traces.models.useQuery({ projectId });
  const nameList = trpc.traces.names.useQuery({ projectId });

  const hasFilters =
    selectedNames.length > 0 ||
    selectedModels.length > 0 ||
    selectedStatuses.length > 0 ||
    selectedEnvs.length > 0 ||
    !!nlpQuery;

  return (
    <div className="space-y-4">
      {/* ── Filter bar ────────────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">
        <form onSubmit={handleSearch} className="relative">
          <MagnifyingGlass
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none"
          />
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Search for anything..."
            className={`h-[30px] w-56 rounded-md border bg-zinc-900 pl-8 pr-8 text-xs text-zinc-100 placeholder-zinc-500 outline-none transition-colors ${
              !!nlpQuery
                ? "border-indigo-500/60"
                : "border-zinc-800 focus:border-zinc-600"
            }`}
          />
          {!!nlpQuery &&
            (traces.isFetching ? (
              <SpinnerGap
                size={14}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-indigo-400 animate-spin"
              />
            ) : (
              <button
                type="button"
                onClick={clearSearch}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
              >
                <XCircle size={14} weight="fill" />
              </button>
            ))}
        </form>

        <div className="h-4 w-px bg-zinc-800" />

        <DateRangePopover
          from={from}
          to={to}
          preset={preset}
          onPreset={applyPreset}
          onCustom={() =>
            navigate({
              search: (prev) => ({
                ...prev,
                preset: undefined,
              }),
            })
          }
          onFromChange={handleFromChange}
          onToChange={handleToChange}
        />

        <div className="h-4 w-px bg-zinc-800" />

        <MultiselectCombobox
          options={nameList.data ?? []}
          selected={selectedNames}
          onChange={(v) =>
            navigate({
              search: (prev) => ({
                ...prev,
                names: v.length ? v : undefined,
              }),
            })
          }
          placeholder="All traces"
        />

        <MultiselectCombobox
          options={modelList.data ?? []}
          selected={selectedModels}
          onChange={(v) =>
            navigate({
              search: (prev) => ({
                ...prev,
                models: v.length ? v : undefined,
              }),
            })
          }
          placeholder="All models"
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
      </div>

      {/* ── Trace table ───────────────────────────────────────── */}
      {traces.isLoading ? null : !traces.data?.traces?.length ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-700 py-16 text-center">
          <Pulse size={32} className="text-zinc-600 mb-3" />
          <p className="text-sm text-zinc-400">No traces found</p>
          <p className="mt-1 text-xs text-zinc-500">
            {hasFilters
              ? "Try adjusting your filters."
              : "Send your first trace using the SDK to see it here."}
          </p>
        </div>
      ) : (
        <div className="rounded-md border border-zinc-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900/50">
                <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500">
                  Name
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500">
                  Status
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500">
                  Spans
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500">
                  Tokens
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500">
                  Cost
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500">
                  Duration
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-zinc-500">
                  Time
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {traces.data.traces.map((trace) => (
                <tr
                  key={trace.id}
                  className="hover:bg-zinc-900/50 transition-colors cursor-pointer"
                  onClick={() =>
                    navigate({
                      to: "/projects/$projectId/trace/$traceId",
                      params: { projectId, traceId: trace.id },
                    })
                  }
                >
                  <td className="px-4 py-3">
                    <span className="font-medium text-zinc-100">
                      {trace.name}
                    </span>
                    {trace.userId && (
                      <span className="ml-2 text-xs text-zinc-500">
                        {trace.userId}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={trace.status} />
                  </td>
                  <td className="px-4 py-3 text-zinc-400">{trace.spanCount}</td>
                  <td className="px-4 py-3 text-zinc-400">
                    {trace.inputTokens + trace.outputTokens > 0
                      ? formatTokens(trace.inputTokens + trace.outputTokens)
                      : "\u2014"}
                  </td>
                  <td className="px-4 py-3 text-zinc-400">
                    {trace.costUsd > 0 ? formatCost(trace.costUsd) : "\u2014"}
                  </td>
                  <td className="px-4 py-3 text-zinc-400">
                    {formatDuration(trace.startTime, trace.endTime)}
                  </td>
                  <td className="px-4 py-3 text-zinc-500 text-xs">
                    {formatTime(trace.startTime)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: "ok" | "error" }) {
  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-red-400">
        <XCircle size={13} weight="fill" />
        error
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
      <CheckCircle size={13} weight="fill" />
      ok
    </span>
  );
}

// ── Formatters ────────────────────────────────────────────────────────────────

function formatCost(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.001) return `$${usd.toFixed(6)}`;
  if (usd < 1) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatDuration(start: string, end: string | null): string {
  if (!end) return "\u2014";
  const ms =
    new Date(end.replace(" ", "T") + "Z").getTime() -
    new Date(start.replace(" ", "T") + "Z").getTime();
  if (!ms || ms < 0) return "\u2014";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatTime(chDate: string): string {
  return new Date(chDate.replace(" ", "T") + "Z").toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
