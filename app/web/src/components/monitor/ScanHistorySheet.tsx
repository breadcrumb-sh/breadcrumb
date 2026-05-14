import { Drawer } from "@base-ui/react/drawer";
import { X } from "@phosphor-icons/react/X";
import { CheckCircle } from "@phosphor-icons/react/CheckCircle";
import { MinusCircle } from "@phosphor-icons/react/MinusCircle";
import { WarningCircle } from "@phosphor-icons/react/WarningCircle";
import { SkipForward } from "@phosphor-icons/react/SkipForward";
import { CircleNotch } from "@phosphor-icons/react/CircleNotch";
import { trpc } from "../../lib/trpc";
import { formatCost } from "../../lib/span-utils";

type RunStatus = "running" | "success" | "empty" | "skipped" | "error";

const statusConfig: Record<RunStatus, { icon: typeof CheckCircle; label: string; color: string }> = {
  success: { icon: CheckCircle, label: "Found issues", color: "text-amber-400" },
  empty: { icon: MinusCircle, label: "No new issues", color: "text-zinc-500" },
  running: { icon: CircleNotch, label: "Running", color: "text-blue-400" },
  skipped: { icon: SkipForward, label: "Skipped", color: "text-zinc-500" },
  error: { icon: WarningCircle, label: "Failed", color: "text-red-400" },
};

export function ScanHistorySheet({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const runs = trpc.monitor.scanRuns.useQuery({ projectId }, { enabled: open });

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} swipeDirection="right">
      <Drawer.Portal>
        <Drawer.Backdrop className="monitor-drawer-backdrop" />
        <Drawer.Viewport className="monitor-drawer-viewport">
          <Drawer.Popup className="h-full w-full sm:w-[480px] bg-zinc-950 border-l border-zinc-800 outline-none">
            <Drawer.Content className="flex flex-col h-full">
              <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
                <Drawer.Title className="text-sm font-medium text-foreground">
                  Scan history
                </Drawer.Title>
                <Drawer.Close className="p-1 rounded hover:bg-zinc-800 text-zinc-400 cursor-pointer">
                  <X size={16} />
                </Drawer.Close>
              </div>

              <div className="flex-1 overflow-y-auto">
                {runs.isLoading && (
                  <div className="p-5 text-sm text-muted-foreground">Loading...</div>
                )}
                {runs.data?.length === 0 && (
                  <div className="p-5 text-sm text-muted-foreground">No scan runs yet.</div>
                )}
                {runs.data?.map((run) => {
                  const cfg = statusConfig[run.status];
                  const Icon = cfg.icon;
                  const duration = run.finishedAt
                    ? Math.round((new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) / 1000)
                    : null;

                  return (
                    <div
                      key={run.id}
                      className="flex items-start gap-3 px-5 py-3 border-b border-zinc-800/50"
                    >
                      <Icon
                        size={18}
                        className={`mt-0.5 shrink-0 ${cfg.color} ${run.status === "running" ? "animate-spin" : ""}`}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-sm text-foreground">
                            {cfg.label}
                            {run.status === "success" && (
                              <span className="text-muted-foreground">
                                {" "}({run.ticketsCreated} issue{run.ticketsCreated === 1 ? "" : "s"})
                              </span>
                            )}
                          </span>
                          <span className="text-xs text-muted-foreground shrink-0">
                            {formatTimestamp(run.startedAt)}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                          {duration !== null && <span>{formatDurationShort(duration)}</span>}
                          {run.costCents > 0 && <span>{formatCost(run.costCents / 100)}</span>}
                        </div>
                        {run.status === "error" && run.errorMessage && (
                          <p className="mt-1 text-xs text-red-400/80 truncate">{run.errorMessage}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Drawer.Content>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  // Show date for older runs
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

function formatDurationShort(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}
