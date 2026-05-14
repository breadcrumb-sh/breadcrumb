import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Tag } from "@phosphor-icons/react/Tag";
import { Trash } from "@phosphor-icons/react/Trash";
import { Plus } from "@phosphor-icons/react/Plus";
import { trpc } from "../../lib/trpc";
import { backdropCls, popupCls } from "./dialog-styles";

const PRESET_COLORS = [
  "#ef4444", "#f59e0b", "#22c55e", "#06b6d4",
  "#3b82f6", "#8b5cf6", "#ec4899", "#6b7280",
];

type LabelDraft = { id: string; name: string; color: string };

export interface LabelsSectionHandle {
  isDirty: boolean;
  save: () => Promise<void>;
  isSaving: boolean;
}

/* ── Color picker popover ──────────────────────────── */

function ColorPicker({
  value,
  onChange,
  onClose,
}: {
  value: string;
  onChange: (color: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute left-0 bottom-[calc(100%+6px)] z-50 flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 p-2 shadow-xl"
    >
      {PRESET_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => {
            onChange(c);
            onClose();
          }}
          className={`size-6 rounded-full transition-all ${
            value === c
              ? "ring-2 ring-zinc-300 ring-offset-2 ring-offset-zinc-900"
              : "hover:scale-110"
          }`}
          style={{ backgroundColor: c }}
        />
      ))}
    </div>
  );
}

/* ── Single label row ──────────────────────────────── */

function LabelRow({
  label,
  onUpdate,
  onDelete,
}: {
  label: LabelDraft;
  onUpdate: (id: string, patch: Partial<{ name: string; color: string }>) => void;
  onDelete: (label: { id: string; name: string }) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const startEditing = () => {
    setEditing(true);
    requestAnimationFrame(() => inputRef.current?.select());
  };

  return (
    <div className="group flex items-center gap-3 rounded-md px-3 py-2 transition-colors hover:bg-zinc-800/40">
      {/* Color dot — click to pick */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setColorOpen((o) => !o)}
          className="size-3 rounded-full shrink-0 translate-y-px transition-transform hover:scale-125 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
          style={{ backgroundColor: label.color }}
          aria-label="Change color"
        />
        {colorOpen && (
          <ColorPicker
            value={label.color}
            onChange={(color) => onUpdate(label.id, { color })}
            onClose={() => setColorOpen(false)}
          />
        )}
      </div>

      {/* Name — click to edit inline */}
      {editing ? (
        <input
          ref={inputRef}
          value={label.name}
          onChange={(e) => onUpdate(label.id, { name: e.target.value })}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "Escape") setEditing(false);
          }}
          maxLength={64}
          className="flex-1 min-w-0 bg-transparent text-sm text-zinc-100 outline-none selection:bg-zinc-700"
        />
      ) : (
        <button
          type="button"
          onClick={startEditing}
          className="flex-1 min-w-0 text-left text-sm text-zinc-200 truncate cursor-text hover:text-zinc-100 transition-colors"
        >
          {label.name}
        </button>
      )}

      {/* Delete */}
      <button
        type="button"
        onClick={() => onDelete({ id: label.id, name: label.name })}
        className="shrink-0 p-1 rounded text-zinc-600 opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-zinc-800 transition-all focus-visible:opacity-100"
        aria-label={`Delete ${label.name}`}
      >
        <Trash size={14} />
      </button>
    </div>
  );
}

/* ── New-label input row ───────────────────────────── */

function NewLabelInput({
  usedColors,
  onCreate,
}: {
  usedColors: string[];
  onCreate: (name: string, color: string) => void;
}) {
  const [name, setName] = useState("");
  const [colorOpen, setColorOpen] = useState(false);

  const nextColor =
    PRESET_COLORS.find((c) => !usedColors.includes(c)) ?? PRESET_COLORS[0];
  const [color, setColor] = useState(nextColor);

  useEffect(() => {
    setColor(PRESET_COLORS.find((c) => !usedColors.includes(c)) ?? PRESET_COLORS[0]);
  }, [usedColors]);

  const handleCreate = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreate(trimmed, color);
    setName("");
  };

  return (
    <div className="flex items-center gap-3 px-3 py-2">
      <div className="relative">
        <button
          type="button"
          onClick={() => setColorOpen((o) => !o)}
          className="size-3 rounded-full shrink-0 translate-y-px transition-transform hover:scale-125 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
          style={{ backgroundColor: color }}
          aria-label="Pick color for new label"
        />
        {colorOpen && (
          <ColorPicker
            value={color}
            onChange={setColor}
            onClose={() => setColorOpen(false)}
          />
        )}
      </div>
      <div className="flex-1 flex items-center gap-2">
        <Plus size={12} className="shrink-0 text-zinc-600" />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleCreate();
            if (e.key === "Escape") setName("");
          }}
          placeholder="Add a label..."
          maxLength={64}
          className="flex-1 min-w-0 bg-transparent text-sm text-zinc-300 placeholder-zinc-600 outline-none"
        />
      </div>
    </div>
  );
}

/* ── Main section ──────────────────────────────────── */

export const LabelsSection = forwardRef<LabelsSectionHandle, { projectId: string }>(
  function LabelsSection({ projectId }, ref) {
    const labels = trpc.labels.list.useQuery({ projectId });
    const utils = trpc.useUtils();
    const invalidate = useCallback(
      () => utils.labels.list.invalidate({ projectId }),
      [utils, projectId],
    );

    const createLabel = trpc.labels.create.useMutation({ onSuccess: invalidate });
    const updateLabel = trpc.labels.update.useMutation({ onSuccess: invalidate });
    const deleteLabelMut = trpc.labels.delete.useMutation({ onSuccess: invalidate });

    // Local draft state — mirrors server data, tracks pending edits
    const [drafts, setDrafts] = useState<LabelDraft[]>([]);
    useEffect(() => {
      if (labels.data) {
        setDrafts(labels.data.map((l) => ({ id: l.id, name: l.name, color: l.color })));
      }
    }, [labels.data]);

    const handleUpdate = (id: string, patch: Partial<{ name: string; color: string }>) => {
      setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
    };

    // Compute dirty state
    const isDirty = labels.data
      ? drafts.some((d) => {
          const original = labels.data!.find((l) => l.id === d.id);
          return original && (original.name !== d.name || original.color !== d.color);
        })
      : false;

    const isSaving = updateLabel.isPending;

    const save = useCallback(async () => {
      if (!labels.data) return;
      const mutations = drafts
        .filter((d) => {
          const original = labels.data!.find((l) => l.id === d.id);
          return original && (original.name !== d.name.trim() || original.color !== d.color);
        })
        .filter((d) => d.name.trim())
        .map((d) =>
          updateLabel.mutateAsync({
            projectId,
            id: d.id,
            name: d.name.trim(),
            color: d.color,
          }),
        );
      await Promise.all(mutations);
    }, [labels.data, drafts, updateLabel, projectId]);

    useImperativeHandle(ref, () => ({ isDirty, save, isSaving }), [isDirty, save, isSaving]);

    const handleCreate = (name: string, color: string) => {
      createLabel.mutate({ projectId, name, color });
    };

    const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);
    const handleDelete = () => {
      if (deleting) {
        deleteLabelMut.mutate({ projectId, id: deleting.id });
        setDeleting(null);
      }
    };

    const usedColors = drafts.map((l) => l.color);
    const hasLabels = drafts.length > 0;

    return (
      <>
        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-1.5">
            Labels
          </label>
          <p className="text-xs text-zinc-500 mb-1.5">
            Categorize monitor items. Click a name to rename it, or a color dot to change it.
          </p>
        </div>

        <div className="rounded-lg border border-zinc-800/70 bg-zinc-900/30 divide-y divide-zinc-800/50">
          {/* Empty state */}
          {labels.data && !hasLabels && (
            <div className="flex flex-col items-center gap-2 py-8 text-zinc-500">
              <Tag size={24} weight="duotone" />
              <p className="text-sm">No labels yet</p>
              <p className="text-xs text-zinc-600">
                Type below to create your first label
              </p>
            </div>
          )}

          {/* Label rows */}
          {drafts.map((label) => (
            <LabelRow
              key={label.id}
              label={label}
              onUpdate={handleUpdate}
              onDelete={setDeleting}
            />
          ))}

          {/* Always-visible creation row */}
          <NewLabelInput usedColors={usedColors} onCreate={handleCreate} />
        </div>

        {/* Delete confirmation */}
        <AlertDialog.Root
          open={deleting !== null}
          onOpenChange={(open) => {
            if (!open) setDeleting(null);
          }}
        >
          <AlertDialog.Portal>
            <AlertDialog.Backdrop className={backdropCls} />
            <AlertDialog.Viewport className="fixed inset-0 z-[60] grid place-items-center px-4">
              <AlertDialog.Popup className={popupCls}>
                <AlertDialog.Title className="text-base font-semibold text-zinc-100 mb-1">
                  Delete "{deleting?.name}"?
                </AlertDialog.Title>
                <AlertDialog.Description className="text-sm text-zinc-400 mb-6">
                  This label will be removed from all monitor items that use it.
                </AlertDialog.Description>
                <div className="flex justify-end gap-2">
                  <AlertDialog.Close className="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 transition-colors">
                    Cancel
                  </AlertDialog.Close>
                  <AlertDialog.Close
                    onClick={handleDelete}
                    className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 transition-colors"
                  >
                    Delete
                  </AlertDialog.Close>
                </div>
              </AlertDialog.Popup>
            </AlertDialog.Viewport>
          </AlertDialog.Portal>
        </AlertDialog.Root>
      </>
    );
  },
);
