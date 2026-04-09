import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Dialog } from "@base-ui/react/dialog";
import { Plus } from "@phosphor-icons/react/Plus";
import { Warning } from "@phosphor-icons/react/Warning";
import { X } from "@phosphor-icons/react/X";
import { useMemo, useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@breadcrumb/server/trpc";
import { useToastManager } from "../common/Toasts";
import { trpc } from "../../lib/trpc";
import { backdropCls, popupCls } from "./dialog-styles";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type Rate = RouterOutputs["modelRates"]["list"][number];

const SOURCE_ORDER: Record<Rate["source"], number> = {
  unset: 0,
  user: 1,
  catalog: 2,
};

export function ModelPricingSection({
  projectId,
  canManage,
}: {
  projectId: string;
  canManage: boolean;
}) {
  const utils = trpc.useUtils();
  const rates = trpc.modelRates.list.useQuery({ projectId });
  const [editing, setEditing] = useState<Rate | null>(null);
  const [adding, setAdding] = useState(false);

  const sorted = useMemo(() => {
    if (!rates.data) return [];
    return [...rates.data].sort((a, b) => {
      const s = SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source];
      if (s !== 0) return s;
      return a.model.localeCompare(b.model);
    });
  }, [rates.data]);

  const unsetCount = useMemo(
    () => sorted.filter((r) => r.source === "unset").length,
    [sorted],
  );

  const invalidate = () => {
    void utils.modelRates.list.invalidate({ projectId });
    void utils.modelRates.unsetCount.invalidate({ projectId });
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Model Pricing</h3>
          <p className="text-xs text-zinc-500 mt-0.5">
            Rates applied when computing LLM span cost. Populated automatically
            from our pricing catalog as models appear in traces.
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 transition-colors"
          >
            <Plus size={14} />
            Add model
          </button>
        )}
      </div>

      {unsetCount > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-800/40 bg-amber-950/20 p-3">
          <Warning size={14} weight="fill" className="text-amber-400 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-200">
            {unsetCount === 1 ? "1 model needs" : `${unsetCount} models need`}{" "}
            rates to be priced correctly. These appeared in traces but no
            pricing was found — click Edit to set rates (or enter zeros to
            confirm the model is free).
          </p>
        </div>
      )}

      {rates.isLoading ? (
        <div className="rounded-lg border border-zinc-800/70 bg-zinc-900/30 p-6 text-center text-sm text-zinc-500">
          Loading…
        </div>
      ) : sorted.length === 0 ? (
        <EmptyState canManage={canManage} onAdd={() => setAdding(true)} />
      ) : (
        <RateTable
          rates={sorted}
          canManage={canManage}
          onEdit={(r) => setEditing(r)}
        />
      )}

      {editing && (
        <EditRateDialog
          key={editing.id}
          rate={editing}
          projectId={projectId}
          onClose={() => setEditing(null)}
          onSaved={invalidate}
        />
      )}

      <AddRateDialog
        open={adding}
        onOpenChange={setAdding}
        projectId={projectId}
        onSaved={invalidate}
      />
    </section>
  );
}

// ── Table ───────────────────────────────────────────────────────────

function RateTable({
  rates,
  canManage,
  onEdit,
}: {
  rates: Rate[];
  canManage: boolean;
  onEdit: (r: Rate) => void;
}) {
  return (
    <div className="rounded-lg border border-zinc-800/70 bg-zinc-900/30 overflow-hidden">
      <table className="w-full text-sm table-auto">
        <thead>
          <tr className="text-[11px] font-medium uppercase tracking-wide text-zinc-500 border-b border-zinc-800/50">
            <th className="text-left font-medium px-4 py-2">Model</th>
            <th
              className="text-right font-medium px-4 py-2 whitespace-nowrap"
              style={{ width: "1%" }}
            >
              Input
            </th>
            <th
              className="text-right font-medium px-4 py-2 whitespace-nowrap"
              style={{ width: "1%" }}
            >
              Output
            </th>
            <th className="px-4 py-2" style={{ width: "1%" }} />
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/50">
          {rates.map((rate) => (
            <tr key={rate.id}>
              <td className="px-4 py-2.5 max-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono text-xs text-zinc-200 truncate">
                    {rate.model}
                  </span>
                  <SourceBadge source={rate.source} />
                </div>
              </td>
              <td className="px-4 py-2.5 text-right text-zinc-300 tabular-nums whitespace-nowrap">
                {rate.source === "unset" ? (
                  <span className="text-zinc-600">—</span>
                ) : (
                  formatRate(rate.inputPerMillionUsd)
                )}
              </td>
              <td className="px-4 py-2.5 text-right text-zinc-300 tabular-nums whitespace-nowrap">
                {rate.source === "unset" ? (
                  <span className="text-zinc-600">—</span>
                ) : (
                  formatRate(rate.outputPerMillionUsd)
                )}
              </td>
              <td className="px-4 py-2.5 text-right">
                {canManage && (
                  <button
                    type="button"
                    onClick={() => onEdit(rate)}
                    className="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
                  >
                    Edit
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SourceBadge({ source }: { source: Rate["source"] }) {
  const styles: Record<Rate["source"], string> = {
    unset: "bg-amber-500/10 text-amber-400",
    user: "bg-sky-500/10 text-sky-400",
    catalog: "bg-zinc-800 text-zinc-400",
  };
  const labels: Record<Rate["source"], string> = {
    unset: "Needs rates",
    user: "Custom",
    catalog: "Auto",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${styles[source]}`}
    >
      {labels[source]}
    </span>
  );
}

function EmptyState({
  canManage,
  onAdd,
}: {
  canManage: boolean;
  onAdd: () => void;
}) {
  return (
    <div className="rounded-lg border border-zinc-800/70 bg-zinc-900/30 p-8 text-center">
      <p className="text-sm text-zinc-400">No models yet.</p>
      <p className="text-xs text-zinc-500 mt-1">
        Rates appear here automatically once you ingest LLM spans with a model
        name.
      </p>
      {canManage && (
        <button
          type="button"
          onClick={onAdd}
          className="mt-4 inline-flex items-center gap-1 rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors"
        >
          <Plus size={12} />
          Add model manually
        </button>
      )}
    </div>
  );
}

// ── Edit dialog ─────────────────────────────────────────────────────

function EditRateDialog({
  rate,
  projectId,
  onClose,
  onSaved,
}: {
  rate: Rate;
  projectId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toasts = useToastManager();
  const upsert = trpc.modelRates.upsert.useMutation();
  const deleteRate = trpc.modelRates.delete.useMutation();
  const reset = trpc.modelRates.resetToDefault.useMutation();

  const [input, setInput] = useState(String(rate.inputPerMillionUsd || 0));
  const [output, setOutput] = useState(String(rate.outputPerMillionUsd || 0));
  const [cacheRead, setCacheRead] = useState(
    rate.cacheReadPerMillionUsd != null ? String(rate.cacheReadPerMillionUsd) : "",
  );
  const [cacheWrite, setCacheWrite] = useState(
    rate.cacheWritePerMillionUsd != null ? String(rate.cacheWritePerMillionUsd) : "",
  );
  const [reasoning, setReasoning] = useState(
    rate.reasoningPerMillionUsd != null ? String(rate.reasoningPerMillionUsd) : "",
  );

  const onSave = async () => {
    const parseOptional = (s: string): number | null | undefined => {
      if (s.trim() === "") return null;
      const n = Number(s);
      return Number.isFinite(n) && n >= 0 ? n : undefined;
    };
    const parseRequired = (s: string): number | undefined => {
      const n = Number(s);
      return Number.isFinite(n) && n >= 0 ? n : undefined;
    };

    const inputNum = parseRequired(input);
    const outputNum = parseRequired(output);
    if (inputNum === undefined || outputNum === undefined) {
      toasts.add({ title: "Input and output rates must be non-negative numbers" });
      return;
    }

    const cacheReadNum = parseOptional(cacheRead);
    const cacheWriteNum = parseOptional(cacheWrite);
    const reasoningNum = parseOptional(reasoning);
    if (
      cacheReadNum === undefined ||
      cacheWriteNum === undefined ||
      reasoningNum === undefined
    ) {
      toasts.add({ title: "Optional rates must be numbers or empty" });
      return;
    }

    try {
      await upsert.mutateAsync({
        projectId,
        model: rate.model,
        inputPerMillionUsd: inputNum,
        outputPerMillionUsd: outputNum,
        cacheReadPerMillionUsd: cacheReadNum,
        cacheWritePerMillionUsd: cacheWriteNum,
        reasoningPerMillionUsd: reasoningNum,
      });
      onSaved();
      onClose();
    } catch (err) {
      toasts.add({
        title: "Save failed",
        description: err instanceof Error ? err.message : "Unknown error",
      });
    }
  };

  const onReset = async () => {
    try {
      await reset.mutateAsync({ projectId, rateId: rate.id });
      onSaved();
      onClose();
    } catch (err) {
      toasts.add({
        title: "Reset failed",
        description: err instanceof Error ? err.message : "Unknown error",
      });
    }
  };

  const onDelete = async () => {
    try {
      await deleteRate.mutateAsync({ projectId, rateId: rate.id });
      onSaved();
      onClose();
    } catch (err) {
      toasts.add({
        title: "Delete failed",
        description: err instanceof Error ? err.message : "Unknown error",
      });
    }
  };

  // Only user-edited rows can be reset — catalog rows are already at
  // default, unset rows have no default to reset to.
  const showReset = rate.source === "user";

  return (
    <Dialog.Root open onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className={backdropCls} />
        <Dialog.Viewport className="fixed inset-0 z-50 grid place-items-center px-4">
          <Dialog.Popup className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-950 p-6 shadow-xl transition-all duration-150 data-[starting-style]:opacity-0 data-[starting-style]:scale-95 data-[ending-style]:opacity-0 data-[ending-style]:scale-95">
            <div className="flex items-start justify-between mb-4">
              <div className="min-w-0">
                <Dialog.Title className="text-base font-semibold text-zinc-100">
                  Edit rate
                </Dialog.Title>
                <Dialog.Description className="mt-0.5 text-xs font-mono text-zinc-500 truncate">
                  {rate.model}
                </Dialog.Description>
              </div>
              <Dialog.Close className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100 transition-colors">
                <X size={16} />
              </Dialog.Close>
            </div>

            <div className="space-y-3">
              <RateField
                label="Input"
                hint="$ per 1M tokens"
                value={input}
                onChange={setInput}
              />
              <RateField
                label="Output"
                hint="$ per 1M tokens"
                value={output}
                onChange={setOutput}
              />
              <div className="pt-2 mt-2 border-t border-zinc-800/60">
                <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500 mb-2">
                  Optional breakdown
                </p>
                <div className="space-y-3">
                  <RateField
                    label="Cache read"
                    hint="falls back to input rate"
                    value={cacheRead}
                    onChange={setCacheRead}
                    optional
                  />
                  <RateField
                    label="Cache write"
                    hint="falls back to input rate"
                    value={cacheWrite}
                    onChange={setCacheWrite}
                    optional
                  />
                  <RateField
                    label="Reasoning"
                    hint="falls back to output rate"
                    value={reasoning}
                    onChange={setReasoning}
                    optional
                  />
                </div>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {showReset && (
                  <button
                    type="button"
                    onClick={onReset}
                    disabled={reset.isPending}
                    className="rounded-md px-2.5 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800 transition-colors disabled:opacity-50"
                  >
                    {reset.isPending ? "Resetting…" : "Reset to default"}
                  </button>
                )}
                <DeleteButton onDelete={onDelete} />
              </div>
              <div className="flex items-center gap-2">
                <Dialog.Close className="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 transition-colors">
                  Cancel
                </Dialog.Close>
                <button
                  type="button"
                  onClick={onSave}
                  disabled={upsert.isPending}
                  className="rounded-md bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-900 hover:bg-zinc-200 transition-colors disabled:opacity-50"
                >
                  {upsert.isPending ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function DeleteButton({ onDelete }: { onDelete: () => void }) {
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger className="rounded-md px-2.5 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-red-400 transition-colors">
        Delete
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className={backdropCls} />
        <AlertDialog.Viewport className="fixed inset-0 z-50 grid place-items-center px-4">
          <AlertDialog.Popup className={popupCls}>
            <AlertDialog.Title className="text-base font-semibold text-zinc-100 mb-1">
              Delete rate?
            </AlertDialog.Title>
            <AlertDialog.Description className="text-sm text-zinc-400 mb-6">
              The rate will be removed. If this model appears in a future
              trace, it'll be re-added from our pricing catalog (or marked as
              needing rates if not found).
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
  );
}

// ── Add dialog ──────────────────────────────────────────────────────

function AddRateDialog({
  open,
  onOpenChange,
  projectId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  projectId: string;
  onSaved: () => void;
}) {
  const toasts = useToastManager();
  const upsert = trpc.modelRates.upsert.useMutation();

  const [model, setModel] = useState("");
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [cacheRead, setCacheRead] = useState("");
  const [cacheWrite, setCacheWrite] = useState("");
  const [reasoning, setReasoning] = useState("");

  const handleClose = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      setModel("");
      setInput("");
      setOutput("");
      setCacheRead("");
      setCacheWrite("");
      setReasoning("");
    }
  };

  const onAdd = async () => {
    if (!model.trim()) {
      toasts.add({ title: "Model name is required" });
      return;
    }
    const inputNum = Number(input || 0);
    const outputNum = Number(output || 0);
    if (!Number.isFinite(inputNum) || inputNum < 0) {
      toasts.add({ title: "Input rate must be a non-negative number" });
      return;
    }
    if (!Number.isFinite(outputNum) || outputNum < 0) {
      toasts.add({ title: "Output rate must be a non-negative number" });
      return;
    }
    const parseOptional = (s: string): number | null | undefined => {
      if (s.trim() === "") return null;
      const n = Number(s);
      return Number.isFinite(n) && n >= 0 ? n : undefined;
    };
    const cacheReadNum = parseOptional(cacheRead);
    const cacheWriteNum = parseOptional(cacheWrite);
    const reasoningNum = parseOptional(reasoning);
    if (
      cacheReadNum === undefined ||
      cacheWriteNum === undefined ||
      reasoningNum === undefined
    ) {
      toasts.add({ title: "Optional rates must be numbers or empty" });
      return;
    }

    try {
      await upsert.mutateAsync({
        projectId,
        model,
        inputPerMillionUsd: inputNum,
        outputPerMillionUsd: outputNum,
        cacheReadPerMillionUsd: cacheReadNum,
        cacheWritePerMillionUsd: cacheWriteNum,
        reasoningPerMillionUsd: reasoningNum,
      });
      onSaved();
      handleClose(false);
    } catch (err) {
      toasts.add({
        title: "Save failed",
        description: err instanceof Error ? err.message : "Unknown error",
      });
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={handleClose}>
      <Dialog.Portal>
        <Dialog.Backdrop className={backdropCls} />
        <Dialog.Viewport className="fixed inset-0 z-50 grid place-items-center px-4">
          <Dialog.Popup className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-950 p-6 shadow-xl transition-all duration-150 data-[starting-style]:opacity-0 data-[starting-style]:scale-95 data-[ending-style]:opacity-0 data-[ending-style]:scale-95">
            <div className="flex items-start justify-between mb-4">
              <div>
                <Dialog.Title className="text-base font-semibold text-zinc-100">
                  Add model
                </Dialog.Title>
                <Dialog.Description className="mt-0.5 text-sm text-zinc-400">
                  Define a rate for a custom model or one not yet seen in traces.
                </Dialog.Description>
              </div>
              <Dialog.Close className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100 transition-colors">
                <X size={16} />
              </Dialog.Close>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">
                  Model name
                </label>
                <input
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="e.g. my-provider/local-llama"
                  className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-zinc-500 font-mono"
                />
              </div>
              <RateField label="Input" hint="$ per 1M tokens" value={input} onChange={setInput} />
              <RateField
                label="Output"
                hint="$ per 1M tokens"
                value={output}
                onChange={setOutput}
              />
              <div className="pt-2 mt-2 border-t border-zinc-800/60">
                <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500 mb-2">
                  Optional breakdown
                </p>
                <div className="space-y-3">
                  <RateField
                    label="Cache read"
                    hint="falls back to input rate"
                    value={cacheRead}
                    onChange={setCacheRead}
                    optional
                  />
                  <RateField
                    label="Cache write"
                    hint="falls back to input rate"
                    value={cacheWrite}
                    onChange={setCacheWrite}
                    optional
                  />
                  <RateField
                    label="Reasoning"
                    hint="falls back to output rate"
                    value={reasoning}
                    onChange={setReasoning}
                    optional
                  />
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <Dialog.Close className="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 transition-colors">
                Cancel
              </Dialog.Close>
              <button
                type="button"
                onClick={onAdd}
                disabled={upsert.isPending}
                className="rounded-md bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-900 hover:bg-zinc-200 transition-colors disabled:opacity-50"
              >
                {upsert.isPending ? "Adding…" : "Add"}
              </button>
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ── Field ───────────────────────────────────────────────────────────

function RateField({
  label,
  hint,
  value,
  onChange,
  optional,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  optional?: boolean;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-3">
      <div>
        <div className="text-sm text-zinc-300">
          {label}
          {optional && <span className="ml-1.5 text-[10px] text-zinc-500">optional</span>}
        </div>
        <div className="text-[11px] text-zinc-500">{hint}</div>
      </div>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={optional ? "—" : "0"}
        className="w-24 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-right text-sm text-zinc-100 tabular-nums outline-none focus:border-zinc-500"
      />
    </div>
  );
}

// ── Formatter ───────────────────────────────────────────────────────

function formatRate(n: number): string {
  if (n === 0) return "$0";
  // Up to 4 decimals, strip trailing zeros.
  const fixed = n.toFixed(4);
  const trimmed = fixed.replace(/\.?0+$/, "");
  return `$${trimmed}`;
}
