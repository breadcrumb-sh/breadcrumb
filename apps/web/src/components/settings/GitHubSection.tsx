import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Dialog } from "@base-ui/react/dialog";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { GithubLogo } from "@phosphor-icons/react/GithubLogo";
import { Lock } from "@phosphor-icons/react/Lock";
import { MagnifyingGlass } from "@phosphor-icons/react/MagnifyingGlass";
import { Trash } from "@phosphor-icons/react/Trash";
import { Warning } from "@phosphor-icons/react/Warning";
import { X } from "@phosphor-icons/react/X";
import { useEffect, useMemo, useRef, useState } from "react";
import { getRouteApi } from "@tanstack/react-router";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@breadcrumb/server/trpc";
import { useToastManager } from "../common/Toasts";
import { trpc } from "../../lib/trpc";
import { backdropCls } from "./dialog-styles";

const route = getRouteApi("/_authed/projects/$projectId/settings");

type RouterOutputs = inferRouterOutputs<AppRouter>;
type Installation = NonNullable<RouterOutputs["github"]["getInstallation"]>;

const MAX_TRACKED = 3;

type Props = {
  projectId: string;
  canManage: boolean;
  /** Query params surfaced from the route's search schema. */
  callback?: { connected?: string; error?: string; info?: string };
};

/**
 * GitHub integration card for the project settings "Integrations" tab.
 *
 * The integration is gated at the instance level on env vars. This
 * component renders five visual states:
 *
 *   1. Loading        — initial isEnabled query in flight
 *   2. Disabled       — instance not configured (env vars unset)
 *   3. Empty          — enabled, no installation linked yet
 *   4. Picker open    — modal showing live repo list with search
 *   5. Connected      — list of tracked repos + edit/disconnect actions
 */
export function GitHubSection({ projectId, canManage, callback }: Props) {
  const status = trpc.github.isEnabled.useQuery();
  const installation = trpc.github.getInstallation.useQuery(
    { projectId },
    { enabled: status.data?.enabled === true },
  );

  const [pickerOpen, setPickerOpen] = useState(false);

  // Auto-open the picker when the user lands here right after a connect
  // (the new tab carrying the ?connected flag, with no tracked repos yet).
  useEffect(() => {
    if (
      callback?.connected &&
      installation.data &&
      installation.data.trackedRepos.length === 0
    ) {
      setPickerOpen(true);
    }
  }, [callback?.connected, installation.data]);

  // Cross-tab catch-up: if the install was completed in a popup, the
  // original tab refetches on focus and sees a fresh installation. We
  // detect the null → present transition and auto-open the picker so the
  // user doesn't have to hunt for "Pick up to 3".
  const prevInstallationId = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (installation.isLoading) return;
    const current = installation.data?.id ?? null;
    if (
      prevInstallationId.current === null &&
      current !== null &&
      installation.data?.trackedRepos.length === 0
    ) {
      setPickerOpen(true);
    }
    prevInstallationId.current = current;
  }, [installation.data, installation.isLoading]);

  // Show toast on callback flag and clear it from the URL.
  useCallbackToasts(callback);

  return (
    <section className="space-y-4 max-w-md">
      <div>
        <h3 className="text-sm font-semibold mb-1">GitHub</h3>
        <p className="text-xs text-zinc-500">
          Connect a repository to give agents code context and file issues from traces.
        </p>
      </div>

      {status.isLoading ? (
        <SkeletonCard />
      ) : !status.data?.enabled ? (
        <DisabledCard />
      ) : installation.isLoading ? (
        <SkeletonCard />
      ) : !installation.data ? (
        <EmptyCard projectId={projectId} canManage={canManage} />
      ) : installation.data.suspendedAt ? (
        <SuspendedCard
          installation={installation.data}
          projectId={projectId}
          canManage={canManage}
        />
      ) : (
        <ConnectedCard
          installation={installation.data}
          projectId={projectId}
          canManage={canManage}
          onEdit={() => setPickerOpen(true)}
        />
      )}

      {installation.data && (
        <PickerDialog
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          projectId={projectId}
          installation={installation.data}
        />
      )}
    </section>
  );
}

// ── Cards ───────────────────────────────────────────────────────────

function CardShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-800/70 bg-zinc-900/30 p-4">
      {children}
    </div>
  );
}

function SkeletonCard() {
  return (
    <CardShell>
      <div className="flex items-start gap-3">
        <div className="h-5 w-5 rounded bg-zinc-800 animate-pulse" />
        <div className="flex-1 space-y-2">
          <div className="h-3 w-24 rounded bg-zinc-800 animate-pulse" />
          <div className="h-3 w-48 rounded bg-zinc-800 animate-pulse" />
        </div>
      </div>
    </CardShell>
  );
}

function DisabledCard() {
  return (
    <CardShell>
      <div className="flex items-start gap-3">
        <GithubLogo size={20} weight="fill" className="text-zinc-500 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-zinc-400">GitHub App</span>
          <p className="mt-1 text-xs text-zinc-500">
            This instance doesn't have a GitHub App configured. Set the GITHUB_APP_*
            environment variables on your server to enable this integration.
          </p>
          <div className="mt-3">
            <button
              type="button"
              disabled
              title="GitHub integration not configured on this instance"
              className="rounded-md border border-zinc-800 px-3 py-1.5 text-sm text-zinc-500 disabled:pointer-events-none"
            >
              Connect repository
            </button>
          </div>
        </div>
      </div>
    </CardShell>
  );
}

function EmptyCard({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const createUrl = trpc.github.createInstallUrl.useMutation();
  const toasts = useToastManager();

  const onConnect = () => {
    // Open the popup synchronously while the user gesture is still
    // "fresh" — popup blockers reject window.open after an await.
    const popup = window.open("about:blank", "github-install");
    if (!popup) {
      toasts.add({
        title: "Popup blocked",
        description: "Allow popups for this site, then click Connect again.",
      });
      return;
    }
    createUrl.mutate(
      { projectId },
      {
        onSuccess: ({ url }) => {
          popup.location.href = url;
        },
        onError: (err) => {
          popup.close();
          toasts.add({
            title: "Couldn't start GitHub install",
            description: err.message,
          });
        },
      },
    );
  };

  return (
    <CardShell>
      <div className="flex items-start gap-3">
        <GithubLogo size={20} weight="fill" className="text-zinc-100 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-zinc-200">GitHub App</span>
          <p className="mt-1 text-xs text-zinc-500">
            No installation linked. Connect an account or organization to pick up to{" "}
            {MAX_TRACKED} repositories.
          </p>
          <div className="mt-3">
            <button
              type="button"
              disabled={!canManage || createUrl.isPending}
              onClick={onConnect}
              title={canManage ? undefined : "Project admins only"}
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 transition-colors disabled:opacity-40 disabled:pointer-events-none"
            >
              {createUrl.isPending ? "Opening GitHub…" : "Connect repository"}
            </button>
          </div>
        </div>
      </div>
    </CardShell>
  );
}

function ConnectedCard({
  installation,
  projectId,
  canManage,
  onEdit,
}: {
  installation: Installation;
  projectId: string;
  canManage: boolean;
  onEdit: () => void;
}) {
  const tracked = installation.trackedRepos;
  const hasTracked = tracked.length > 0;
  return (
    <CardShell>
      <div className="space-y-3">
        <InstallationHeader installation={installation} />

        {!hasTracked ? (
          <p className="text-xs text-zinc-500">
            No repositories tracked yet.{" "}
            {canManage && (
              <button
                type="button"
                onClick={onEdit}
                className="text-zinc-300 hover:text-zinc-100 underline underline-offset-2"
              >
                Pick up to {MAX_TRACKED}
              </button>
            )}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {tracked.map((repo) => (
              <li key={repo.id} className="flex items-center gap-2 text-sm">
                {repo.isPrivate && <Lock size={12} className="text-zinc-500 shrink-0" />}
                <a
                  href={repo.htmlUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-zinc-200 hover:text-zinc-100 truncate"
                >
                  {repo.fullName}
                </a>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={onEdit}
            disabled={!canManage}
            title={canManage ? undefined : "Project admins only"}
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors disabled:opacity-40 disabled:pointer-events-none"
          >
            Edit selection
          </button>
          {canManage && hasTracked && (
            <RunScanButton projectId={projectId} />
          )}
          {canManage && <DisconnectButton projectId={projectId} />}
        </div>
      </div>
    </CardShell>
  );
}

// ── Run scan ────────────────────────────────────────────────────────

function RunScanButton({ projectId }: { projectId: string }) {
  const runScan = trpc.github.runScan.useMutation();
  const toasts = useToastManager();

  const onClick = async () => {
    try {
      const result = await runScan.mutateAsync({ projectId });
      if (result.status === "success") {
        const dollars = (result.costCents / 100).toFixed(2);
        toasts.add({
          title: "Repo scan complete",
          description: `Project memory updated. Cost: $${dollars}`,
        });
      } else if (result.status === "skipped") {
        toasts.add({
          title: "Scan skipped",
          description: result.errorMessage ?? "Unknown reason",
        });
      } else {
        toasts.add({
          title: "Scan failed",
          description: result.errorMessage ?? "Unknown error",
        });
      }
    } catch (err) {
      toasts.add({
        title: "Scan failed",
        description: err instanceof Error ? err.message : "Unknown error",
      });
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={runScan.isPending}
      title="Explore the tracked repositories and update project memory. Takes ~1-2 minutes."
      className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors disabled:opacity-40 disabled:pointer-events-none"
    >
      {runScan.isPending ? "Scanning…" : "Run scan"}
    </button>
  );
}

function SuspendedCard({
  installation,
  projectId,
  canManage,
}: {
  installation: Installation;
  projectId: string;
  canManage: boolean;
}) {
  const createUrl = trpc.github.createInstallUrl.useMutation();
  const toasts = useToastManager();

  const onReconnect = () => {
    const popup = window.open("about:blank", "github-install");
    if (!popup) {
      toasts.add({
        title: "Popup blocked",
        description: "Allow popups for this site, then click Reconnect again.",
      });
      return;
    }
    createUrl.mutate(
      { projectId },
      {
        onSuccess: ({ url }) => {
          popup.location.href = url;
        },
        onError: (err) => {
          popup.close();
          toasts.add({
            title: "Couldn't start GitHub install",
            description: err.message,
          });
        },
      },
    );
  };

  return (
    <CardShell>
      <div className="space-y-3">
        <InstallationHeader installation={installation} />
        <div className="flex items-start gap-2 rounded-md border border-amber-800/40 bg-amber-950/20 p-2.5">
          <Warning size={14} weight="fill" className="text-amber-400 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-200">
            This installation was removed on GitHub. Reconnect to restore access.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onReconnect}
            disabled={!canManage || createUrl.isPending}
            title={canManage ? undefined : "Project admins only"}
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors disabled:opacity-40 disabled:pointer-events-none"
          >
            {createUrl.isPending ? "Opening GitHub…" : "Reconnect"}
          </button>
          {canManage && <DisconnectButton projectId={projectId} />}
        </div>
      </div>
    </CardShell>
  );
}

function InstallationHeader({ installation }: { installation: Installation }) {
  return (
    <div className="flex items-center gap-2.5">
      {installation.accountAvatarUrl ? (
        <img
          src={installation.accountAvatarUrl}
          alt=""
          className="h-6 w-6 rounded-full bg-zinc-800"
        />
      ) : (
        <GithubLogo size={20} weight="fill" className="text-zinc-100" />
      )}
      <div className="min-w-0">
        <div className="text-sm font-medium text-zinc-100 truncate">
          {installation.accountLogin}
        </div>
        <div className="text-[11px] text-zinc-500">
          {installation.accountType} ·{" "}
          {installation.repositorySelection === "all" ? "All repos" : "Selected repos"}
        </div>
      </div>
    </div>
  );
}

// ── Disconnect ──────────────────────────────────────────────────────

function DisconnectButton({ projectId }: { projectId: string }) {
  const utils = trpc.useUtils();
  const disconnect = trpc.github.disconnect.useMutation({
    onSuccess: () => utils.github.getInstallation.invalidate({ projectId }),
  });
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger
        className="rounded-md border border-zinc-800 px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-red-400 transition-colors flex items-center gap-1.5"
      >
        <Trash size={12} />
        Disconnect
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className={backdropCls} />
        <AlertDialog.Viewport className="fixed inset-0 z-50 grid place-items-center px-4">
          <AlertDialog.Popup className="w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-950 p-6 shadow-xl transition-all duration-150 data-[starting-style]:opacity-0 data-[starting-style]:scale-95 data-[ending-style]:opacity-0 data-[ending-style]:scale-95">
            <AlertDialog.Title className="text-base font-semibold text-zinc-100 mb-1">
              Disconnect GitHub?
            </AlertDialog.Title>
            <AlertDialog.Description className="text-sm text-zinc-400 mb-6">
              This removes the link for this project and clears your repo selection.
              The app stays installed on GitHub — uninstall there to fully revoke access.
            </AlertDialog.Description>
            <div className="flex justify-end gap-2">
              <AlertDialog.Close className="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 transition-colors">
                Cancel
              </AlertDialog.Close>
              <AlertDialog.Close
                onClick={() => disconnect.mutate({ projectId })}
                className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 transition-colors"
              >
                Disconnect
              </AlertDialog.Close>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Viewport>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

// ── Picker Dialog ───────────────────────────────────────────────────

function PickerDialog({
  open,
  onOpenChange,
  projectId,
  installation,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  projectId: string;
  installation: Installation;
}) {
  const utils = trpc.useUtils();
  const repos = trpc.github.listAvailableRepos.useQuery(
    { projectId },
    { enabled: open },
  );
  const setTracked = trpc.github.setTrackedRepos.useMutation({
    onSuccess: () => {
      utils.github.getInstallation.invalidate({ projectId });
      onOpenChange(false);
    },
  });
  const toasts = useToastManager();

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [query, setQuery] = useState("");

  // Initialize selection from currently tracked when the modal opens or
  // when fresh data arrives.
  useEffect(() => {
    if (open && repos.data) {
      setSelected(new Set(repos.data.trackedRepoIds));
      setQuery("");
    }
  }, [open, repos.data]);

  const filtered = useMemo(() => {
    if (!repos.data) return [];
    const q = query.trim().toLowerCase();
    if (!q) return repos.data.available;
    return repos.data.available.filter((r) => r.fullName.toLowerCase().includes(q));
  }, [repos.data, query]);

  const toggle = (repoId: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(repoId)) {
        next.delete(repoId);
      } else if (next.size < MAX_TRACKED) {
        next.add(repoId);
      }
      return next;
    });
  };

  const onSave = async () => {
    try {
      await setTracked.mutateAsync({
        projectId,
        repoIds: Array.from(selected),
      });
    } catch (err) {
      toasts.add({
        title: "Couldn't save selection",
        description: err instanceof Error ? err.message : "Unknown error",
      });
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className={backdropCls} />
        <Dialog.Viewport className="fixed inset-0 z-50 grid place-items-center px-4">
          <Dialog.Popup className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-950 p-6 shadow-xl transition-all duration-150 data-[starting-style]:opacity-0 data-[starting-style]:scale-95 data-[ending-style]:opacity-0 data-[ending-style]:scale-95">
            <div className="flex items-start justify-between mb-4">
              <div>
                <Dialog.Title className="text-base font-semibold text-zinc-100">
                  Pick repositories
                </Dialog.Title>
                <Dialog.Description className="mt-0.5 text-sm text-zinc-400">
                  Choose up to {MAX_TRACKED} repos from{" "}
                  <span className="text-zinc-300">{installation.accountLogin}</span>.
                </Dialog.Description>
              </div>
              <Dialog.Close className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100 transition-colors">
                <X size={16} />
              </Dialog.Close>
            </div>

            <div className="relative mb-3">
              <MagnifyingGlass
                size={14}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500"
              />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search repositories"
                className="w-full rounded-md border border-zinc-700 bg-zinc-900 pl-8 pr-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-zinc-500"
              />
            </div>

            <div className="rounded-md border border-zinc-800 max-h-72 overflow-y-auto">
              {repos.isLoading ? (
                <div className="px-3 py-6 text-center text-sm text-zinc-500">
                  Loading repositories…
                </div>
              ) : repos.error ? (
                <div className="px-3 py-6 text-center text-sm text-red-400">
                  {repos.error.message}
                </div>
              ) : filtered.length === 0 ? (
                <div className="px-3 py-6 text-center text-sm text-zinc-500">
                  {query ? "No matches." : "No repositories granted to this installation."}
                </div>
              ) : (
                <ul className="divide-y divide-zinc-800">
                  {filtered.map((repo) => {
                    const isSelected = selected.has(repo.repoId);
                    const atCap = selected.size >= MAX_TRACKED;
                    const disabled = !isSelected && atCap;
                    return (
                      <li key={repo.repoId}>
                        <button
                          type="button"
                          onClick={() => toggle(repo.repoId)}
                          disabled={disabled}
                          className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-zinc-900/50 transition-colors disabled:opacity-40 disabled:pointer-events-none"
                        >
                          <div
                            className={`size-4 rounded border flex items-center justify-center shrink-0 ${
                              isSelected
                                ? "bg-zinc-100 border-zinc-100"
                                : "border-zinc-600"
                            }`}
                          >
                            {isSelected && (
                              <CheckCircle size={12} weight="fill" className="text-zinc-900" />
                            )}
                          </div>
                          {repo.isPrivate && (
                            <Lock size={11} className="text-zinc-500 shrink-0" />
                          )}
                          <span className="text-sm text-zinc-200 truncate">
                            {repo.fullName}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="mt-4 flex items-center justify-between">
              <span className="text-xs text-zinc-500">
                {selected.size} of {MAX_TRACKED} selected
              </span>
              <div className="flex items-center gap-2">
                <Dialog.Close className="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 transition-colors">
                  Cancel
                </Dialog.Close>
                <button
                  type="button"
                  onClick={onSave}
                  disabled={setTracked.isPending}
                  className="rounded-md bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-900 hover:bg-zinc-200 transition-colors disabled:opacity-50"
                >
                  {setTracked.isPending ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ── Toast effect ────────────────────────────────────────────────────

function useCallbackToasts(callback: Props["callback"]) {
  const navigate = route.useNavigate();
  const toasts = useToastManager();

  useEffect(() => {
    if (!callback) return;
    let title: string | null = null;
    let description: string | undefined;

    if (callback.connected) {
      title = "GitHub connected";
      description = "Pick the repositories you want to track.";
    } else if (callback.info === "install_pending") {
      title = "Install request sent";
      description = "An org admin needs to approve before the connection appears.";
    } else if (callback.error) {
      title = "GitHub connection failed";
      description = errorMessage(callback.error);
    }

    if (!title) return;

    toasts.add({ title, description });

    // Strip the flag from the URL so a refresh doesn't re-fire the toast.
    navigate({
      search: (prev) => ({
        ...prev,
        connected: undefined,
        error: undefined,
        info: undefined,
      }),
      replace: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callback?.connected, callback?.error, callback?.info]);
}

function errorMessage(code: string): string {
  switch (code) {
    case "invalid_state":
      return "Sign-in expired during connect. Please try again.";
    case "forbidden":
      return "You no longer have admin access to this project.";
    case "not_found":
      return "GitHub installation was removed before we could record it.";
    case "unauthorized":
      return "GitHub denied access. Please reconnect.";
    case "invalid_installation":
      return "GitHub returned an unexpected response.";
    case "github_unavailable":
      return "Couldn't reach GitHub. Try again in a moment.";
    case "project_not_found":
      return "Project no longer exists.";
    default:
      return code;
  }
}
