import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Dialog } from "@base-ui/react/dialog";
import { Brain } from "@phosphor-icons/react/Brain";
import { Check } from "@phosphor-icons/react/Check";
import { Eye } from "@phosphor-icons/react/Eye";
import { Gear } from "@phosphor-icons/react/Gear";
import { Plus } from "@phosphor-icons/react/Plus";
import { Trash } from "@phosphor-icons/react/Trash";
import { X } from "@phosphor-icons/react/X";
import { getRouteApi, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { useAuth } from "../../hooks/useAuth";
import { trpc } from "../../lib/trpc";

const backdropCls =
  "fixed inset-0 z-50 bg-black/60 backdrop-blur-sm transition-opacity duration-150 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0";
const popupCls =
  "w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-950 p-6 shadow-xl transition-all duration-150 data-[starting-style]:opacity-0 data-[starting-style]:scale-95 data-[ending-style]:opacity-0 data-[ending-style]:scale-95";

const routeApi = getRouteApi("/_authed/projects/$projectId/traces");

const IMPACT_STYLES = {
  high: {
    badge: "border-red-600/30 bg-red-500/10 text-red-400",
    bar: "bg-red-500",
  },
  medium: {
    badge: "border-amber-600/30 bg-amber-500/10 text-amber-400",
    bar: "bg-amber-500",
  },
  low: {
    badge: "border-zinc-600 bg-zinc-800/50 text-zinc-400",
    bar: "bg-zinc-500",
  },
} as const;

type ObservationFormValues = {
  name: string;
  traceNames: string[];
  samplingRate: number;
  traceLimit: number | null;
  heuristics: string;
};

export function ObservationsSection() {
  const { projectId } = routeApi.useParams();
  const { authenticated } = useAuth();
  const utils = trpc.useUtils();
  const [createOpen, setCreateOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  const aiProvider = trpc.aiProviders.get.useQuery({ projectId }, {
    enabled: authenticated,
  });
  const list = trpc.observations.list.useQuery({ projectId });
  const findings = trpc.observations["findings.listAll"].useQuery({ projectId });
  const markViewed = trpc.observations.markViewed.useMutation({
    onSuccess: () => utils.observations.unreadCount.invalidate({ projectId }),
  });
  const dismiss = trpc.observations["findings.dismiss"].useMutation({
    onSuccess: () => utils.observations["findings.listAll"].invalidate({ projectId }),
  });
  const create = trpc.observations.create.useMutation({
    onSuccess: () => utils.observations.list.invalidate({ projectId }),
  });
  const setEnabled = trpc.observations.setEnabled.useMutation({
    onSuccess: () => utils.observations.list.invalidate({ projectId }),
  });
  const remove = trpc.observations.delete.useMutation({
    onSuccess: () => {
      utils.observations.list.invalidate({ projectId });
      utils.observations["findings.listAll"].invalidate({ projectId });
    },
  });

  const markedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!authenticated) return;
    if (markedRef.current === projectId) return;
    markedRef.current = projectId;
    markViewed.mutate({ projectId });
  }, [projectId, authenticated]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCreate = async (values: ObservationFormValues) => {
    await create.mutateAsync({
      projectId,
      name: values.name,
      traceNames: values.traceNames,
      samplingRate: values.samplingRate,
      traceLimit: values.traceLimit ?? undefined,
      heuristics: values.heuristics || undefined,
    });
    setCreateOpen(false);
  };

  if (aiProvider.isLoading || findings.isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-sm text-zinc-600">
        Loading…
      </div>
    );
  }

  if (aiProvider.data === null) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-5 text-center">
        <div className="flex items-center justify-center w-12 h-12 rounded-full border border-zinc-800 bg-zinc-900">
          <Brain size={22} className="text-zinc-500" />
        </div>
        <div className="space-y-1.5">
          <h2 className="text-base font-medium text-zinc-200">AI provider not configured</h2>
          <p className="text-sm text-zinc-500 leading-relaxed max-w-xs">
            Set up an AI provider in your project settings to enable automatic trace observations.
          </p>
        </div>
        <Link
          to="/projects/$projectId/settings"
          params={{ projectId }}
          search={{ tab: "ai" }}
          className="text-sm text-zinc-400 underline hover:text-zinc-200 transition-colors"
        >
          Configure AI provider
        </Link>
      </div>
    );
  }

  const items = findings.data ?? [];
  const observations = list.data ?? [];

  return (
    <>
      {/* Header bar */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-xs text-zinc-500">
            AI monitors new traces against each observation and surfaces issues automatically.
          </p>
        </div>
        <button
          onClick={() => setSheetOpen(true)}
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 border border-zinc-800 transition-colors"
        >
          <Gear size={14} />
          Manage
          {observations.length > 0 && (
            <span className="ml-0.5 text-zinc-500">{observations.length}</span>
          )}
        </button>
      </div>

      {/* Findings */}
      {items.length > 0 ? (
        <div className="space-y-3">
          {items.map((f) => {
            const styles =
              IMPACT_STYLES[f.impact as keyof typeof IMPACT_STYLES] ??
              IMPACT_STYLES.low;

            return (
              <div
                key={f.id}
                className="rounded-lg border border-zinc-800 bg-zinc-900 overflow-hidden"
              >
                <div className={`h-0.5 ${styles.bar}`} />
                <div className="px-5 pt-4 pb-4">
                  <div className="flex items-start gap-3">
                    <span
                      className={`mt-0.5 shrink-0 inline-flex items-center rounded border px-1.5 py-[2px] text-[10px] font-medium leading-none ${styles.badge}`}
                    >
                      {f.impact}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-zinc-100 prose-finding">
                        <ReactMarkdown>{f.title}</ReactMarkdown>
                      </div>
                      <div className="mt-0.5 text-xs text-zinc-400 prose-finding">
                        <ReactMarkdown>{f.description}</ReactMarkdown>
                      </div>
                      {f.suggestion && (
                        <div className="mt-2 text-xs text-zinc-500 pl-3 border-l border-zinc-700 italic prose-finding">
                          <ReactMarkdown>{f.suggestion}</ReactMarkdown>
                        </div>
                      )}
                      <div className="mt-3 flex items-center gap-3">
                        <span className="text-[10px] text-zinc-600">{f.observationName ?? "Deleted observation"}</span>
                        <Link
                          to="/projects/$projectId/trace/$traceId"
                          params={{ projectId, traceId: f.referenceTraceId }}
                          className="text-[10px] font-mono text-zinc-600 hover:text-zinc-400 transition-colors"
                        >
                          {f.referenceTraceId.slice(0, 16)}…
                        </Link>
                        <span className="text-[10px] text-zinc-700">
                          {new Date(f.createdAt).toLocaleString(undefined, {
                            month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
                          })}
                        </span>
                        <AlertDialog.Root>
                          <AlertDialog.Trigger className="ml-auto text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors">
                            Dismiss
                          </AlertDialog.Trigger>
                          <AlertDialog.Portal>
                            <AlertDialog.Backdrop className={backdropCls} />
                            <AlertDialog.Viewport className="fixed inset-0 z-50 grid place-items-center px-4">
                              <AlertDialog.Popup className={popupCls}>
                                <AlertDialog.Title className="text-base font-semibold text-zinc-100 mb-1">
                                  Dismiss finding?
                                </AlertDialog.Title>
                                <AlertDialog.Description className="text-sm text-zinc-400 mb-6">
                                  This finding will be hidden. It won't affect future observations.
                                </AlertDialog.Description>
                                <div className="flex justify-end gap-2">
                                  <AlertDialog.Close className="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 transition-colors">
                                    Cancel
                                  </AlertDialog.Close>
                                  <AlertDialog.Close
                                    onClick={() => dismiss.mutate({ projectId, id: f.id })}
                                    className="rounded-md bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-900 hover:bg-zinc-200 transition-colors"
                                  >
                                    Dismiss
                                  </AlertDialog.Close>
                                </div>
                              </AlertDialog.Popup>
                            </AlertDialog.Viewport>
                          </AlertDialog.Portal>
                        </AlertDialog.Root>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
          <Eye size={32} className="text-zinc-700" />
          <div>
            <p className="text-sm text-zinc-400">No findings yet</p>
            <p className="text-xs text-zinc-600 mt-1">
              Observations run automatically after each trace completes.
            </p>
          </div>
        </div>
      )}

      {/* Sidesheet backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-black/50 transition-opacity duration-300 ${
          sheetOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={() => setSheetOpen(false)}
      />

      {/* Sidesheet panel */}
      <div
        className={`fixed right-0 top-0 z-50 h-full w-full max-w-md overflow-y-auto border-l border-zinc-800 bg-zinc-950 transition-transform duration-300 ${
          sheetOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-zinc-800">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">Manage observations</h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              Create and manage what the AI watches for.
            </p>
          </div>
          <button
            onClick={() => setSheetOpen(false)}
            className="p-1 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* New observation button + dialog */}
          <Dialog.Root open={createOpen} onOpenChange={setCreateOpen}>
            <Dialog.Trigger className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 border border-zinc-800 transition-colors w-full justify-center">
              <Plus size={14} />
              New observation
            </Dialog.Trigger>

            <Dialog.Portal>
              <Dialog.Backdrop className={backdropCls} />
              <Dialog.Viewport className="fixed inset-0 z-[60] grid place-items-center px-4 py-8 overflow-y-auto">
                <Dialog.Popup className="w-full max-w-lg rounded-xl border border-zinc-800 bg-zinc-950 p-6 shadow-xl transition-all duration-150 data-[starting-style]:opacity-0 data-[starting-style]:scale-95 data-[ending-style]:opacity-0 data-[ending-style]:scale-95">
                  <div className="flex items-start justify-between mb-5">
                    <div>
                      <Dialog.Title className="text-base font-semibold text-zinc-100">
                        New observation
                      </Dialog.Title>
                      <Dialog.Description className="mt-0.5 text-sm text-zinc-400">
                        Define what the AI should watch for across incoming traces.
                      </Dialog.Description>
                    </div>
                    <Dialog.Close className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100 transition-colors">
                      <X size={16} />
                    </Dialog.Close>
                  </div>

                  <ObservationForm
                    onSubmit={handleCreate}
                    onCancel={() => setCreateOpen(false)}
                    isPending={create.isPending}
                    projectId={projectId}
                  />
                </Dialog.Popup>
              </Dialog.Viewport>
            </Dialog.Portal>
          </Dialog.Root>

          {/* Observation list */}
          <div className="rounded-md border border-zinc-800 divide-y divide-zinc-800">
            {observations.map((obs) => (
              <ObservationRow
                key={obs.id}
                obs={obs}
                projectId={projectId}
                onDelete={() => remove.mutate({ projectId, id: obs.id })}
                onToggle={() =>
                  setEnabled.mutate({ projectId, id: obs.id, enabled: !obs.enabled })
                }
              />
            ))}
            {observations.length === 0 && (
              <div className="px-4 py-10 text-center">
                <Eye size={28} className="mx-auto mb-2 text-zinc-700" />
                <p className="text-sm text-zinc-500">No observations yet.</p>
                <p className="text-xs text-zinc-600 mt-0.5">
                  Create one to start monitoring traces automatically.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

/* ── Observation row ─────────────────────────────────────────── */

type ObservationRowData = {
  id: string;
  name: string;
  traceNames: string[] | null;
  samplingRate: number;
  traceLimit: number | null;
  tracesEvaluated: number;
  heuristics: string | null;
  enabled: boolean;
};

function ObservationRow({
  obs,
  projectId,
  onDelete,
  onToggle,
}: {
  obs: ObservationRowData;
  projectId: string;
  onDelete: () => void;
  onToggle: () => void;
}) {
  const stats = trpc.observations.queueStats.useQuery(
    { projectId, observationId: obs.id },
    { refetchInterval: 10_000 },
  );

  const { queued = 0, active = 0, completed = 0 } = stats.data ?? {};
  const inFlight = queued + active;

  return (
    <div className="flex items-start justify-between px-4 py-3 gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-zinc-100 truncate">{obs.name}</p>
          <span
            className={`shrink-0 inline-flex items-center rounded border px-1.5 py-[2px] text-[10px] font-medium leading-none ${
              obs.enabled
                ? "border-emerald-600/30 bg-emerald-600/10 text-emerald-600"
                : "border-zinc-700 bg-zinc-800/50 text-zinc-500"
            }`}
          >
            {obs.enabled ? "active" : "paused"}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1">
          {(obs.traceNames ?? []).length > 0 ? (
            <p className="text-xs text-zinc-500">
              Traces:{" "}
              {(obs.traceNames ?? []).slice(0, 3).map((n, i) => (
                <span key={n}>
                  <span className="text-zinc-400 font-mono">{n}</span>
                  {i < Math.min((obs.traceNames ?? []).length, 3) - 1 && ", "}
                </span>
              ))}
              {(obs.traceNames ?? []).length > 3 && (
                <span className="text-zinc-600"> +{(obs.traceNames ?? []).length - 3} more</span>
              )}
            </p>
          ) : (
            <p className="text-xs text-zinc-500">All traces</p>
          )}
          <p className="text-xs text-zinc-500">
            Sampling: <span className="text-zinc-400">{obs.samplingRate}%</span>
          </p>
          {obs.traceLimit !== null && (
            <p className="text-xs text-zinc-500">
              <span className="text-zinc-400">{obs.tracesEvaluated}</span>
              {" / "}
              <span className="text-zinc-400">{obs.traceLimit}</span>
              {" traces"}
            </p>
          )}
          {stats.data && (
            <p className="text-xs text-zinc-500">
              <span className="text-zinc-400">{completed}</span> processed
              {inFlight > 0 && (
                <>
                  {" · "}
                  <span className="text-zinc-400">{inFlight}</span> queued
                </>
              )}
            </p>
          )}
        </div>
        {obs.heuristics && (
          <p className="text-xs text-zinc-600 mt-1 line-clamp-1">{obs.heuristics}</p>
        )}
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={onToggle}
          title={obs.enabled ? "Pause" : "Resume"}
          className="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors text-xs"
        >
          {obs.enabled ? "Pause" : "Resume"}
        </button>

        <AlertDialog.Root>
          <AlertDialog.Trigger className="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-red-400 transition-colors">
            <Trash size={16} />
          </AlertDialog.Trigger>
          <AlertDialog.Portal>
            <AlertDialog.Backdrop className={backdropCls} />
            <AlertDialog.Viewport className="fixed inset-0 z-50 grid place-items-center px-4">
              <AlertDialog.Popup className={popupCls}>
                <AlertDialog.Title className="text-base font-semibold text-zinc-100 mb-1">
                  Delete observation?
                </AlertDialog.Title>
                <AlertDialog.Description className="text-sm text-zinc-400 mb-6">
                  <span className="text-zinc-300">{obs.name}</span> will stop monitoring new traces.
                </AlertDialog.Description>
                <div className="flex justify-end gap-2">
                  <AlertDialog.Close className="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 transition-colors">
                    Cancel
                  </AlertDialog.Close>
                  <AlertDialog.Close
                    onClick={onDelete}
                    className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 transition-colors"
                  >
                    Delete
                  </AlertDialog.Close>
                </div>
              </AlertDialog.Popup>
            </AlertDialog.Viewport>
          </AlertDialog.Portal>
        </AlertDialog.Root>
      </div>
    </div>
  );
}

/* ── Create observation form ─────────────────────────────────── */

function ObservationForm({
  onSubmit,
  onCancel,
  isPending,
  projectId,
}: {
  onSubmit: (values: ObservationFormValues) => void;
  onCancel: () => void;
  isPending?: boolean;
  projectId: string;
}) {
  const [name, setName] = useState("");
  const [traceNames, setTraceNames] = useState<string[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [samplingRate, setSamplingRate] = useState(100);
  const [traceLimit, setTraceLimit] = useState<string>("");
  const [heuristics, setHeuristics] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);

  const availableNames = trpc.traces.names.useQuery({ projectId });

  const filtered = (availableNames.data ?? []).filter(
    (n) => n.toLowerCase().includes(filter.toLowerCase()) && !traceNames.includes(n),
  );

  const toggle = (n: string) => {
    setTraceNames((prev) =>
      prev.includes(n) ? prev.filter((x) => x !== n) : [...prev, n],
    );
  };

  const removeTrace = (n: string) => setTraceNames((prev) => prev.filter((x) => x !== n));

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
        setFilter("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsedLimit = traceLimit ? parseInt(traceLimit, 10) : null;
    onSubmit({ name, traceNames, samplingRate, traceLimit: parsedLimit, heuristics });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Name */}
      <div>
        <label className="block text-sm font-medium text-zinc-300 mb-1.5">
          Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Detect hallucinations, High latency spikes"
          required
          autoFocus
          className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-zinc-500"
        />
      </div>

      {/* Trace multiselect */}
      <div>
        <label className="block text-sm font-medium text-zinc-300 mb-1">
          Traces
        </label>
        <p className="text-xs text-zinc-500 mb-1.5">
          Limit to specific trace names. Leave empty to monitor all traces.
        </p>

        {/* Selected tags */}
        {traceNames.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {traceNames.map((n) => (
              <span
                key={n}
                className="flex items-center gap-1 rounded bg-zinc-800 border border-zinc-700 pl-2 pr-1 py-0.5 text-xs text-zinc-200 font-mono"
              >
                {n}
                <button
                  type="button"
                  onClick={() => removeTrace(n)}
                  className="rounded text-zinc-500 hover:text-zinc-200 transition-colors"
                >
                  <X size={10} weight="bold" />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Dropdown trigger */}
        <div ref={dropdownRef} className="relative">
          <button
            type="button"
            onClick={() => {
              setDropdownOpen((v) => !v);
              setTimeout(() => filterRef.current?.focus(), 0);
            }}
            className="flex items-center justify-between w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-left transition-colors hover:border-zinc-600 focus:outline-none focus:border-zinc-500"
          >
            <span className={traceNames.length === 0 ? "text-zinc-500" : "text-zinc-100"}>
              {traceNames.length === 0
                ? "Select traces…"
                : `${traceNames.length} selected`}
            </span>
            <svg
              className={`w-4 h-4 text-zinc-500 transition-transform ${dropdownOpen ? "rotate-180" : ""}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {dropdownOpen && (
            <div className="absolute z-10 mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 shadow-lg">
              <div className="p-1.5 border-b border-zinc-800">
                <input
                  ref={filterRef}
                  type="text"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter traces…"
                  className="w-full bg-zinc-800 rounded px-2.5 py-1.5 text-sm text-zinc-100 placeholder-zinc-500 outline-none"
                />
              </div>
              <ul className="max-h-48 overflow-y-auto py-1">
                {availableNames.isLoading && (
                  <li className="px-3 py-2 text-xs text-zinc-500">Loading…</li>
                )}
                {!availableNames.isLoading && filtered.length === 0 && (
                  <li className="px-3 py-2 text-xs text-zinc-500">No traces found.</li>
                )}
                {filtered.map((n) => (
                  <li key={n}>
                    <button
                      type="button"
                      onClick={() => toggle(n)}
                      className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-left hover:bg-zinc-800 transition-colors"
                    >
                      <span
                        className={`flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                          traceNames.includes(n)
                            ? "border-zinc-400 bg-zinc-400"
                            : "border-zinc-600"
                        }`}
                      >
                        {traceNames.includes(n) && (
                          <Check size={10} weight="bold" className="text-zinc-900" />
                        )}
                      </span>
                      <span className="font-mono text-zinc-200 truncate">{n}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* Sampling rate */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-sm font-medium text-zinc-300">
            Sampling rate
          </label>
          <span className="text-sm font-mono text-zinc-400">{samplingRate}%</span>
        </div>
        <p className="text-xs text-zinc-500 mb-2">
          Percentage of matching traces the AI will analyze.
        </p>
        <input
          type="range"
          min={1}
          max={100}
          value={samplingRate}
          onChange={(e) => setSamplingRate(Number(e.target.value))}
          className="w-full accent-zinc-100 cursor-pointer"
        />
        <div className="flex justify-between text-[10px] text-zinc-600 mt-1">
          <span>1%</span>
          <span>50%</span>
          <span>100%</span>
        </div>
      </div>

      {/* Trace limit */}
      <div>
        <label className="block text-sm font-medium text-zinc-300 mb-1.5">
          Stop after{" "}
          <span className="text-zinc-500 font-normal">(optional)</span>
        </label>
        <p className="text-xs text-zinc-500 mb-1.5">
          Automatically pause this observation after evaluating this many traces.
        </p>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            value={traceLimit}
            onChange={(e) => setTraceLimit(e.target.value)}
            placeholder="e.g. 100"
            className="w-32 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-zinc-500"
          />
          <span className="text-sm text-zinc-500">traces</span>
        </div>
      </div>

      {/* Heuristics */}
      <div>
        <label className="block text-sm font-medium text-zinc-300 mb-1.5">
          Heuristics & context{" "}
          <span className="text-zinc-500 font-normal">(optional)</span>
        </label>
        <p className="text-xs text-zinc-500 mb-1.5">
          Describe what to look for. Supports markdown. The AI uses this as guidance.
        </p>
        <textarea
          value={heuristics}
          onChange={(e) => setHeuristics(e.target.value)}
          placeholder={`## What to watch for\n- Unexpected refusals\n- Hallucinated facts\n- Unusually high token usage`}
          rows={5}
          className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-zinc-500 font-mono resize-y"
        />
      </div>

      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-900 hover:bg-zinc-200 transition-colors disabled:opacity-50"
        >
          Create observation
        </button>
      </div>
    </form>
  );
}
