import { useState } from "react";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Pencil } from "@phosphor-icons/react/Pencil";
import { Plus } from "@phosphor-icons/react/Plus";
import { Trash } from "@phosphor-icons/react/Trash";
import { trpc } from "../../lib/trpc";
import { backdropCls, popupCls } from "./dialog-styles";

const PRESET_COLORS = [
  "#ef4444", "#f59e0b", "#22c55e", "#06b6d4",
  "#3b82f6", "#8b5cf6", "#ec4899", "#6b7280",
];

export function LabelsSection({ projectId }: { projectId: string }) {
  const labels = trpc.labels.list.useQuery({ projectId });
  const utils = trpc.useUtils();

  const createLabel = trpc.labels.create.useMutation({
    onSuccess: () => utils.labels.list.invalidate({ projectId }),
  });
  const updateLabel = trpc.labels.update.useMutation({
    onSuccess: () => utils.labels.list.invalidate({ projectId }),
  });
  const deleteLabel = trpc.labels.delete.useMutation({
    onSuccess: () => utils.labels.list.invalidate({ projectId }),
  });

  const [editing, setEditing] = useState<{ id?: string; name: string; color: string } | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const handleSave = () => {
    if (!editing || !editing.name.trim()) return;
    if (editing.id) {
      updateLabel.mutate({ projectId, id: editing.id, name: editing.name.trim(), color: editing.color });
    } else {
      createLabel.mutate({ projectId, name: editing.name.trim(), color: editing.color });
    }
    setEditing(null);
  };

  const handleDelete = () => {
    if (deleteId) {
      deleteLabel.mutate({ projectId, id: deleteId });
      setDeleteId(null);
    }
  };

  return (
    <section className="space-y-6 max-w-md">
      <div>
        <h3 className="text-sm font-semibold mb-1">Labels</h3>
        <p className="text-xs text-zinc-400">
          Labels help categorize monitor items. The AI agent can also apply labels during investigations.
        </p>
      </div>

      <div className="space-y-1">
        {labels.data?.map((label) => (
          <div
            key={label.id}
            className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-zinc-900 group transition-colors"
          >
            <div
              className="size-3 rounded-full shrink-0"
              style={{ backgroundColor: label.color }}
            />
            <span className="text-sm text-zinc-200 flex-1">{label.name}</span>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={() => setEditing({ id: label.id, name: label.name, color: label.color })}
                className="p-1 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
              >
                <Pencil size={14} />
              </button>
              <button
                onClick={() => setDeleteId(label.id)}
                className="p-1 rounded text-zinc-500 hover:text-red-400 hover:bg-zinc-800 transition-colors"
              >
                <Trash size={14} />
              </button>
            </div>
          </div>
        ))}

        {labels.data?.length === 0 && (
          <p className="text-sm text-zinc-500 py-4">No labels yet.</p>
        )}
      </div>

      <button
        onClick={() => setEditing({ name: "", color: PRESET_COLORS[0] })}
        className="flex items-center gap-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
      >
        <Plus size={14} weight="bold" />
        Add label
      </button>

      {/* Edit / Create inline form */}
      {editing && (
        <div className="rounded-md border border-zinc-800 bg-zinc-900/50 p-4 space-y-3">
          <input
            autoFocus
            value={editing.name}
            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
            placeholder="Label name"
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-zinc-500"
          />
          <div className="flex items-center gap-2">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setEditing({ ...editing, color: c })}
                className={`size-6 rounded-full transition-all ${editing.color === c ? "ring-2 ring-zinc-400 ring-offset-2 ring-offset-zinc-950" : "hover:scale-110"}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={!editing.name.trim()}
              className="rounded-md bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-900 hover:bg-zinc-200 transition-colors disabled:opacity-50"
            >
              {editing.id ? "Save" : "Create"}
            </button>
            <button
              onClick={() => setEditing(null)}
              className="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      <AlertDialog.Root open={deleteId !== null} onOpenChange={(open) => { if (!open) setDeleteId(null); }}>
        <AlertDialog.Portal>
          <AlertDialog.Backdrop className={backdropCls} />
          <AlertDialog.Viewport className="fixed inset-0 z-[60] grid place-items-center px-4">
            <AlertDialog.Popup className={popupCls}>
              <AlertDialog.Title className="text-base font-semibold text-zinc-100 mb-1">
                Delete this label?
              </AlertDialog.Title>
              <AlertDialog.Description className="text-sm text-zinc-400 mb-6">
                This will remove the label from all monitor items.
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
    </section>
  );
}
