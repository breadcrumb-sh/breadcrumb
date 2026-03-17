import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { MagnifyingGlass } from "@phosphor-icons/react/MagnifyingGlass";
import { Pulse } from "@phosphor-icons/react/Pulse";
import { SpinnerGap } from "@phosphor-icons/react/SpinnerGap";
import { XCircle } from "@phosphor-icons/react/XCircle";
import { keepPreviousData } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { capture } from "../../lib/telemetry";
import { useEffect, useRef, useState } from "react";
import { DataTable, type Column, type SortState } from "../common/DataTable";
import {
  DateRangePopover,
  presetFrom,
  today,
} from "../common/DateRangePopover";
import { MultiselectCombobox } from "../common/MultiselectCombobox";
import { useToastManager } from "../common/Toasts";
import { trpc } from "../../lib/trpc";
import { formatCost } from "../../lib/span-utils";

const route = getRouteApi("/_authed/projects/$projectId/traces");

// ── Types ─────────────────────────────────────────────────────────────────────

type TraceRow = {
  id: string;
  name: string;
  status: "ok" | "error";
  statusMessage: string;
  startTime: string;
  endTime: string | null;
  userId: string;
  environment: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  spanCount: number;
};

// ── Formatters ────────────────────────────────────────────────────────────────

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

// ── Columns ───────────────────────────────────────────────────────────────────

const TRACE_COLUMNS: Column<TraceRow>[] = [
  {
    key: "name",
    header: "Name",
    sortable: true,
    render: (t) => (
      <>
        <span className="font-medium text-zinc-100">{t.name}</span>
        {t.userId && (
          <span className="ml-2 text-xs text-zinc-500">{t.userId}</span>
        )}
      </>
    ),
  },
  {
    key: "status",
    header: "Status",
    sortable: true,
    render: (t) => <StatusBadge status={t.status} />,
  },
  {
    key: "spanCount",
    header: "Spans",
    sortable: true,
    render: (t) => <span className="text-zinc-400">{t.spanCount}</span>,
  },
  {
    key: "tokens",
    header: "Tokens",
    sortable: true,
    render: (t) => (
      <span className="text-zinc-400">
        {t.inputTokens + t.outputTokens > 0
          ? formatTokens(t.inputTokens + t.outputTokens)
          : "\u2014"}
      </span>
    ),
  },
  {
    key: "cost",
    header: "Cost",
    sortable: true,
    render: (t) => (
      <span className="text-zinc-400">
        {t.costUsd > 0 ? formatCost(t.costUsd) : "\u2014"}
      </span>
    ),
  },
  {
    key: "duration",
    header: "Duration",
    sortable: true,
    render: (t) => (
      <span className="text-zinc-400">
        {formatDuration(t.startTime, t.endTime)}
      </span>
    ),
  },
  {
    key: "startTime",
    header: "Time",
    sortable: true,
    render: (t) => (
      <span className="text-zinc-500 text-xs">{formatTime(t.startTime)}</span>
    ),
  },
];

// ── Raw Traces Section ────────────────────────────────────────────────────────

const EMPTY_STRINGS: string[] = [];
const EMPTY_STATUSES: ("ok" | "error")[] = [];

export function RawTracesSection() {
  const { projectId } = route.useParams();
  const navigate = route.useNavigate();
  const search = route.useSearch();

  const from = search.from ?? presetFrom(30);
  const to = search.to ?? today();
  const preset = search.preset ?? 30;
  const selectedNames = search.names ?? EMPTY_STRINGS;
  const selectedModels = search.models ?? EMPTY_STRINGS;
  const selectedStatuses = search.statuses ?? EMPTY_STATUSES;
  const selectedEnvs = search.env ?? EMPTY_STRINGS;
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
    if (trimmed) {
      capture("trace_search_used");
    }
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

  const sortBy = search.sortBy ?? "startTime";
  const sortDir = search.sortDir ?? "desc";
  const sort: SortState = { key: sortBy, dir: sortDir };

  const handleSortChange = (next: SortState | null) => {
    navigate({
      search: (prev) => ({
        ...prev,
        sortBy: next?.key as typeof sortBy | undefined,
        sortDir: next?.dir,
      }),
    });
  };

  const traces = trpc.traces.list.useQuery(
    {
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
      sortBy,
      sortDir,
    },
    { placeholderData: keepPreviousData, refetchInterval: 10_000 },
  );

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
        <DataTable
          columns={TRACE_COLUMNS}
          data={traces.data.traces}
          rowKey={(t) => t.id}
          onRowClick={(trace) =>
            navigate({
              to: "/projects/$projectId/trace/$traceId",
              params: { projectId, traceId: trace.id },
            })
          }
          sort={sort}
          onSortChange={handleSortChange}
        />
      )}
    </div>
  );
}
