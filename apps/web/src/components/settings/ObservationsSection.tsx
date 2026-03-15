import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Dialog } from "@base-ui/react/dialog";
import { Brain } from "@phosphor-icons/react/Brain";
import { Check } from "@phosphor-icons/react/Check";
import { Eye } from "@phosphor-icons/react/Eye";
import { Plus } from "@phosphor-icons/react/Plus";
import { Trash } from "@phosphor-icons/react/Trash";
import { X } from "@phosphor-icons/react/X";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { trpc } from "../../lib/trpc";
import { backdropCls, popupCls } from "./dialog-styles";

type ObservationFormValues = {
  name: string;
  traceNames: string[];
  samplingRate: number;
  traceLimit: number | null;
  heuristics: string;
};

export function ObservationsSection({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const utils = trpc.useUtils();

  const aiProvider = trpc.aiProviders.get.useQuery({ projectId });
  const list = trpc.observations.list.useQuery({ projectId });
  const create = trpc.observations.create.useMutation({
    onSuccess: () => utils.observations.list.invalidate({ projectId }),
  });
  const setEnabled = trpc.observations.setEnabled.useMutation({
    onSuccess: () => utils.observations.list.invalidate({ projectId }),
  });
  const remove = trpc.observations.delete.useMutation({
    onSuccess: () => utils.observations.list.invalidate({ projectId }),
  });

  const handleCreate = async (values: ObservationFormValues) => {
    await create.mutateAsync({
      projectId,
      name: values.name,
      traceNames: values.traceNames,
      samplingRate: values.samplingRate,
      traceLimit: values.traceLimit ?? undefined,
      heuristics: values.heuristics || undefined,
    });
    setOpen(false);
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Observations</h3>
          <p className="text-xs text-zinc-500 mt-0.5">
            AI monitors new traces against each observation and surfaces issues automatically.
          </p>
        </div>

        <Dialog.Root open={open} onOpenChange={setOpen}>
          <Dialog.Trigger className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 transition-colors">
            <Plus size={14} />
            New observation
          </Dialog.Trigger>

          <Dialog.Portal>
            <Dialog.Backdrop className={backdropCls} />
            <Dialog.Viewport className="fixed inset-0 z-50 grid place-items-center px-4 py-8 overflow-y-auto">
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
                  onCancel={() => setOpen(false)}
                  isPending={create.isPending}
                  projectId={projectId}
                />
              </Dialog.Popup>
            </Dialog.Viewport>
          </Dialog.Portal>
        </Dialog.Root>
      </div>

      {aiProvider.data === null && (
        <div className="rounded-md border border-zinc-800 bg-zinc-900/40 px-4 py-5 flex items-start gap-3">
          <Brain size={18} className="text-zinc-500 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm text-zinc-300 font-medium">AI provider not configured</p>
            <p className="text-xs text-zinc-500 mt-0.5">
              Observations are defined here, but evaluations won't run until an AI provider is set up.{" "}
              <Link
                to="/projects/$projectId/settings"
                params={{ projectId }}
                search={{ tab: "ai" }}
                className="underline hover:text-zinc-300 transition-colors"
              >
                Configure AI provider
              </Link>
            </p>
          </div>
        </div>
      )}

      <div className="rounded-md border border-zinc-800 divide-y divide-zinc-800">
        {list.data?.map((obs) => (
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
        {list.data?.length === 0 && (
          <div className="px-4 py-10 text-center">
            <Eye size={28} className="mx-auto mb-2 text-zinc-700" />
            <p className="text-sm text-zinc-500">No observations yet.</p>
            <p className="text-xs text-zinc-600 mt-0.5">
              Create one to start monitoring traces automatically.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

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

  const remove = (n: string) => setTraceNames((prev) => prev.filter((x) => x !== n));

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
                  onClick={() => remove(n)}
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
