import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Plus } from "@phosphor-icons/react/Plus";
import { Trash } from "@phosphor-icons/react/Trash";
import { Copy } from "@phosphor-icons/react/Copy";
import { Check } from "@phosphor-icons/react/Check";
import { X } from "@phosphor-icons/react/X";
import { Dialog } from "@base-ui/react/dialog";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { usePageView } from "../../hooks/usePageView";
import { trpc } from "../../lib/trpc";
import { AppHeader } from "../../components/layout/AppHeader";

export const Route = createFileRoute("/_authed/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  usePageView("global_settings");
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <AppHeader />
      <main className="px-4 py-8 sm:px-8 page-container-small">
        <h1 className="text-lg font-semibold mb-8">Settings</h1>
        <McpSection />
      </main>
    </div>
  );
}

// ── Shared dialog styles ────────────────────────────────────────────

const backdropCls =
  "fixed inset-0 z-50 bg-black/60 backdrop-blur-sm transition-opacity duration-150 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0";

const popupCls =
  "w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-950 p-6 shadow-xl transition-all duration-150 data-[starting-style]:opacity-0 data-[starting-style]:scale-95 data-[ending-style]:opacity-0 data-[ending-style]:scale-95";

// ── MCP Section ─────────────────────────────────────────────────────

const API_URL = typeof window !== "undefined" ? window.location.origin : "http://localhost:3100";

function McpSection() {
  const [open, setOpen] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [copiedJson, setCopiedJson] = useState(false);

  const utils = trpc.useUtils();
  const mcpKeys = trpc.mcpKeys.list.useQuery();
  const createKey = trpc.mcpKeys.create.useMutation({
    onSuccess: () => utils.mcpKeys.list.invalidate(),
  });
  const deleteKey = trpc.mcpKeys.delete.useMutation({
    onSuccess: () => utils.mcpKeys.list.invalidate(),
  });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = await createKey.mutateAsync({ name: keyName });
    setCreatedKey(result.rawKey);
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setKeyName("");
      setCreatedKey(null);
      setCopiedKey(false);
      setCopiedCmd(false);
      setCopiedJson(false);
    }
  };

  const copy = async (text: string, set: (v: boolean) => void) => {
    await navigator.clipboard.writeText(text);
    set(true);
    setTimeout(() => set(false), 2000);
  };

  const cliCommand = createdKey
    ? `claude mcp add --transport http breadcrumb ${API_URL}/mcp --header "Authorization: Bearer ${createdKey}"`
    : "";

  const desktopJson = createdKey
    ? JSON.stringify(
        {
          mcpServers: {
            breadcrumb: {
              url: `${API_URL}/mcp`,
              headers: { Authorization: `Bearer ${createdKey}` },
            },
          },
        },
        null,
        2
      )
    : "";

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">MCP Keys</h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            Grants read-only access to traces across all your projects via the Model Context Protocol.
          </p>
        </div>

        <Dialog.Root open={open} onOpenChange={handleOpenChange}>
          <Dialog.Trigger className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 transition-colors">
            <Plus size={14} />
            New key
          </Dialog.Trigger>

          <Dialog.Portal>
            <Dialog.Backdrop className={backdropCls} />
            <Dialog.Viewport className="fixed inset-0 z-50 grid place-items-center px-4">
              <Dialog.Popup className="w-full max-w-lg rounded-xl border border-zinc-800 bg-zinc-950 p-6 shadow-xl transition-all duration-150 data-[starting-style]:opacity-0 data-[starting-style]:scale-95 data-[ending-style]:opacity-0 data-[ending-style]:scale-95">
                <div className="flex items-start justify-between mb-5">
                  <div>
                    <Dialog.Title className="text-base font-semibold text-zinc-100">
                      {createdKey ? "MCP key created" : "New MCP key"}
                    </Dialog.Title>
                    <Dialog.Description className="mt-0.5 text-sm text-zinc-400">
                      {createdKey
                        ? "Copy your key and connection strings before closing."
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
                        placeholder="e.g. Claude Code, Claude Desktop"
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
                    <div>
                      <p className="text-xs font-medium text-zinc-400 mb-1.5">MCP Key</p>
                      <div className="flex items-center gap-2 rounded-md border border-zinc-700 bg-zinc-900 p-3">
                        <code className="flex-1 text-sm text-zinc-100 break-all font-mono">
                          {createdKey}
                        </code>
                        <button
                          onClick={() => copy(createdKey, setCopiedKey)}
                          className="shrink-0 rounded p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
                        >
                          {copiedKey ? (
                            <Check size={14} weight="bold" className="text-emerald-400" />
                          ) : (
                            <Copy size={14} />
                          )}
                        </button>
                      </div>
                    </div>

                    <div>
                      <p className="text-xs font-medium text-zinc-400 mb-1.5">Claude Code CLI</p>
                      <div className="relative rounded-md border border-zinc-700 bg-zinc-900 p-3 pr-9 overflow-hidden">
                        <code className="block text-xs text-zinc-100 whitespace-pre-wrap break-all font-mono">
                          {cliCommand}
                        </code>
                        <button
                          onClick={() => copy(cliCommand, setCopiedCmd)}
                          className="absolute top-2 right-2 rounded p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
                        >
                          {copiedCmd ? (
                            <Check size={14} weight="bold" className="text-emerald-400" />
                          ) : (
                            <Copy size={14} />
                          )}
                        </button>
                      </div>
                    </div>

                    <div>
                      <p className="text-xs font-medium text-zinc-400 mb-1.5">Claude Desktop (JSON)</p>
                      <div className="relative rounded-md border border-zinc-700 bg-zinc-900 p-3 pr-9 overflow-hidden">
                        <code className="block text-xs text-zinc-100 whitespace-pre-wrap break-all font-mono">
                          {desktopJson}
                        </code>
                        <button
                          onClick={() => copy(desktopJson, setCopiedJson)}
                          className="absolute top-2 right-2 rounded p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
                        >
                          {copiedJson ? (
                            <Check size={14} weight="bold" className="text-emerald-400" />
                          ) : (
                            <Copy size={14} />
                          )}
                        </button>
                      </div>
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
        {mcpKeys.data?.map((key) => (
          <div key={key.id} className="flex items-center justify-between px-4 py-3">
            <div>
              <p className="text-sm font-medium text-zinc-100">{key.name}</p>
              <p className="text-xs text-zinc-500 font-mono">{key.keyPrefix}</p>
            </div>

            <AlertDialog.Root>
              <AlertDialog.Trigger className="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-red-400 transition-colors">
                <Trash size={16} />
              </AlertDialog.Trigger>
              <AlertDialog.Portal>
                <AlertDialog.Backdrop className={backdropCls} />
                <AlertDialog.Viewport className="fixed inset-0 z-50 grid place-items-center px-4">
                  <AlertDialog.Popup className={popupCls}>
                    <AlertDialog.Title className="text-base font-semibold text-zinc-100 mb-1">
                      Delete MCP key?
                    </AlertDialog.Title>
                    <AlertDialog.Description className="text-sm text-zinc-400 mb-6">
                      Any MCP client using <span className="font-mono text-zinc-300">{key.keyPrefix}</span> will lose access immediately.
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
          </div>
        ))}
        {!mcpKeys.data?.length && (
          <div className="px-4 py-6 text-center text-sm text-zinc-500">
            No MCP keys yet.
          </div>
        )}
      </div>
    </section>
  );
}
