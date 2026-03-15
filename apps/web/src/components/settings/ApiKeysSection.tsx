import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Dialog } from "@base-ui/react/dialog";
import { Check } from "@phosphor-icons/react/Check";
import { Copy } from "@phosphor-icons/react/Copy";
import { Plus } from "@phosphor-icons/react/Plus";
import { Trash } from "@phosphor-icons/react/Trash";
import { X } from "@phosphor-icons/react/X";
import { useState } from "react";
import { trpc } from "../../lib/trpc";
import { backdropCls, popupCls } from "./dialog-styles";

export function ApiKeysSection({
  projectId,
  canManage,
}: {
  projectId: string;
  canManage: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const utils = trpc.useUtils();
  const apiKeys = trpc.apiKeys.list.useQuery({ projectId });
  const createKey = trpc.apiKeys.create.useMutation({
    onSuccess: () => utils.apiKeys.list.invalidate({ projectId }),
  });
  const deleteKey = trpc.apiKeys.delete.useMutation({
    onSuccess: () => utils.apiKeys.list.invalidate({ projectId }),
  });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = await createKey.mutateAsync({ projectId, name: keyName });
    setCreatedKey(result.rawKey);
  };

  const handleCopy = async () => {
    if (!createdKey) return;
    await navigator.clipboard.writeText(createdKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setKeyName("");
      setCreatedKey(null);
      setCopied(false);
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">API Keys</h3>

        <Dialog.Root open={open} onOpenChange={handleOpenChange}>
          {canManage && (
            <Dialog.Trigger className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 transition-colors">
              <Plus size={14} />
              New key
            </Dialog.Trigger>
          )}

          <Dialog.Portal>
            <Dialog.Backdrop className={backdropCls} />
            <Dialog.Viewport className="fixed inset-0 z-50 grid place-items-center px-4">
              <Dialog.Popup className={popupCls}>
                <div className="flex items-start justify-between mb-5">
                  <div>
                    <Dialog.Title className="text-base font-semibold text-zinc-100">
                      {createdKey ? "Your API key" : "New API key"}
                    </Dialog.Title>
                    <Dialog.Description className="mt-0.5 text-sm text-zinc-400">
                      {createdKey
                        ? "Copy this now — you won't be able to see it again."
                        : "Give this key a name to identify where it's used."}
                    </Dialog.Description>
                  </div>
                  <Dialog.Close className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100 transition-colors">
                    <X size={16} />
                  </Dialog.Close>
                </div>

                {!createdKey ? (
                  <form onSubmit={handleCreate} className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-zinc-300 mb-1.5">
                        Key name
                      </label>
                      <input
                        type="text"
                        value={keyName}
                        onChange={(e) => setKeyName(e.target.value)}
                        placeholder="e.g. Production, Development"
                        required
                        autoFocus
                        className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-zinc-500"
                      />
                    </div>
                    <div className="flex items-center justify-end gap-2 pt-1">
                      <Dialog.Close className="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 transition-colors">
                        Cancel
                      </Dialog.Close>
                      <button
                        type="submit"
                        disabled={createKey.isPending}
                        className="rounded-md bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-900 hover:bg-zinc-200 transition-colors disabled:opacity-50"
                      >
                        Create key
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 rounded-md border border-zinc-700 bg-zinc-900 p-3">
                      <code className="flex-1 text-sm text-zinc-100 break-all font-mono">
                        {createdKey}
                      </code>
                      <button
                        onClick={handleCopy}
                        className="shrink-0 rounded p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
                      >
                        {copied ? (
                          <Check
                            size={14}
                            weight="bold"
                            className="text-emerald-400"
                          />
                        ) : (
                          <Copy size={14} />
                        )}
                      </button>
                    </div>
                    <div className="flex justify-end">
                      <Dialog.Close className="rounded-md bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-900 hover:bg-zinc-200 transition-colors">
                        Done
                      </Dialog.Close>
                    </div>
                  </div>
                )}
              </Dialog.Popup>
            </Dialog.Viewport>
          </Dialog.Portal>
        </Dialog.Root>
      </div>

      <div className="rounded-md border border-zinc-800 divide-y divide-zinc-800">
        {apiKeys.data?.map((key) => (
          <div
            key={key.id}
            className="flex items-center justify-between px-4 py-3"
          >
            <div>
              <p className="text-sm font-medium text-zinc-100">{key.name}</p>
              <p className="text-xs text-zinc-500 font-mono">{key.keyPrefix}</p>
            </div>

            {canManage && (
              <AlertDialog.Root>
                <AlertDialog.Trigger className="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-red-400 transition-colors">
                  <Trash size={16} />
                </AlertDialog.Trigger>
                <AlertDialog.Portal>
                  <AlertDialog.Backdrop className={backdropCls} />
                  <AlertDialog.Viewport className="fixed inset-0 z-50 grid place-items-center px-4">
                    <AlertDialog.Popup className={popupCls}>
                      <AlertDialog.Title className="text-base font-semibold text-zinc-100 mb-1">
                        Delete API key?
                      </AlertDialog.Title>
                      <AlertDialog.Description className="text-sm text-zinc-400 mb-6">
                        Any application using{" "}
                        <span className="font-mono text-zinc-300">
                          {key.keyPrefix}
                        </span>{" "}
                        will stop working immediately.
                      </AlertDialog.Description>
                      <div className="flex justify-end gap-2">
                        <AlertDialog.Close className="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 transition-colors">
                          Cancel
                        </AlertDialog.Close>
                        <AlertDialog.Close
                          onClick={() => deleteKey.mutate({ id: key.id })}
                          className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 transition-colors"
                        >
                          Delete
                        </AlertDialog.Close>
                      </div>
                    </AlertDialog.Popup>
                  </AlertDialog.Viewport>
                </AlertDialog.Portal>
              </AlertDialog.Root>
            )}
          </div>
        ))}
        {!apiKeys.data?.length && (
          <div className="px-4 py-6 text-center text-sm text-zinc-500">
            No API keys yet.
          </div>
        )}
      </div>
    </section>
  );
}
