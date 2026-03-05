import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Brain, Eye } from "@phosphor-icons/react";
import { getRouteApi, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import ReactMarkdown from "react-markdown";
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

export function ObservationsSection() {
  const { projectId } = routeApi.useParams();
  const utils = trpc.useUtils();
  const aiProvider = trpc.aiProviders.get.useQuery({ projectId });
  const findings = trpc.observations["findings.listAll"].useQuery({ projectId });
  const markViewed = trpc.observations.markViewed.useMutation({
    onSuccess: () => utils.observations.unreadCount.invalidate({ projectId }),
  });
  const dismiss = trpc.observations["findings.dismiss"].useMutation({
    onSuccess: () => utils.observations["findings.listAll"].invalidate({ projectId }),
  });

  useEffect(() => {
    markViewed.mutate({ projectId });
  }, [projectId]);

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

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
        <Eye size={32} className="text-zinc-700" />
        <div>
          <p className="text-sm text-zinc-400">No findings yet</p>
          <p className="text-xs text-zinc-600 mt-1">
            Observations run automatically after each trace completes.
          </p>
        </div>
      </div>
    );
  }

  return (
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
                  className={`mt-0.5 shrink-0 inline-flex items-center rounded border px-1.5 py-px text-[10px] font-medium leading-none ${styles.badge}`}
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
  );
}
