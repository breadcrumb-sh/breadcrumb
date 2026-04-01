import { useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { backdropCls, popupCls } from "../settings/dialog-styles";
import { trpc } from "../../lib/trpc";

export function CreateItemDialog({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const utils = trpc.useUtils();

  const createItem = trpc.monitor.create.useMutation({
    onSuccess: () => {
      utils.monitor.list.invalidate({ projectId });
      onOpenChange(false);
      setTitle("");
      setDescription("");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    createItem.mutate({
      projectId,
      title: title.trim(),
      description: description.trim() || undefined,
    });
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className={backdropCls} />
        <Dialog.Viewport className="fixed inset-0 z-50 grid place-items-center px-4">
          <Dialog.Popup className={popupCls}>
            <Dialog.Title className="text-base font-semibold text-zinc-100 mb-1">
              Add monitoring request
            </Dialog.Title>
            <Dialog.Description className="text-sm text-zinc-400 mb-5">
              Describe what the agent should watch for in your traces.
            </Dialog.Description>
            <form onSubmit={handleSubmit} className="space-y-4">
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Watch for hallucinated API endpoints"
                autoFocus
                className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-zinc-500"
              />
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Additional context... (optional)"
                rows={4}
                className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-zinc-500 resize-y"
              />
              <div className="flex justify-end gap-2">
                <Dialog.Close className="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 transition-colors">
                  Cancel
                </Dialog.Close>
                <button
                  type="submit"
                  disabled={!title.trim() || createItem.isPending}
                  className="rounded-md bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-900 hover:bg-zinc-200 transition-colors disabled:opacity-50"
                >
                  {createItem.isPending ? "Adding..." : "Add to queue"}
                </button>
              </div>
            </form>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
