import { useState, useRef, useEffect, useCallback } from "react";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Drawer } from "@base-ui/react/drawer";
import { CaretRight } from "@phosphor-icons/react/CaretRight";
import { DotsThree } from "@phosphor-icons/react/DotsThree";
import { EyeSlash } from "@phosphor-icons/react/EyeSlash";
import { PaperPlaneTilt } from "@phosphor-icons/react/PaperPlaneTilt";
import { Robot } from "@phosphor-icons/react/Robot";
import { Trash } from "@phosphor-icons/react/Trash";
import { User } from "@phosphor-icons/react/User";
import { X } from "@phosphor-icons/react/X";
import { Markdown } from "../common/Markdown";
import { useClickOutside } from "../../hooks/useClickOutside";
import { trpc } from "../../lib/trpc";
import { backdropCls, popupCls } from "../settings/dialog-styles";
import { statusInfo, formatTime } from "./columns";
import type { MonitorItem } from "./types";

export function MonitorItemSheet({
  item,
  open,
  onOpenChange,
  onDismiss,
  onDelete,
}: {
  item: MonitorItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDismiss: () => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDismiss, setConfirmDismiss] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useClickOutside(menuRef, () => setMenuOpen(false));

  if (!item) return null;

  const { label: statusText, dotColor, Icon: StatusIcon } = statusInfo(item.status);

  return (
    <>
      <Drawer.Root open={open} onOpenChange={onOpenChange} swipeDirection="right">
        <Drawer.Portal>
          <Drawer.Backdrop className="monitor-drawer-backdrop" />
          <Drawer.Viewport className="monitor-drawer-viewport">
            <Drawer.Popup className="monitor-drawer-popup">
              <Drawer.Content className="flex flex-col h-full">
                {/* Header */}
                <div className="shrink-0 bg-zinc-950 border-b border-zinc-800 px-5 py-4 flex items-start justify-between gap-4 sticky top-0 z-10">
                  <div className="min-w-0">
                    <Drawer.Title className="text-base font-semibold text-zinc-100">
                      {item.title}
                    </Drawer.Title>
                    <div className="flex items-center gap-3 mt-2">
                      <span className="flex items-center gap-1.5 text-xs text-zinc-400">
                        <StatusIcon className={`size-3.5 ${dotColor}`} />
                        {statusText}
                      </span>
                      {item.source === "agent" && (
                        <span className="text-[11px] font-medium px-1.5 py-0.5 rounded border text-violet-400 bg-violet-400/10 border-violet-400/20">
                          Agent
                        </span>
                      )}
                      {item.processing && (
                        <span className="text-[11px] font-medium px-1.5 py-0.5 rounded border text-amber-400 bg-amber-400/10 border-amber-400/20">
                          Processing
                        </span>
                      )}
                      {item.dismissed && (
                        <span className="text-[11px] font-medium px-1.5 py-0.5 rounded border text-zinc-400 bg-zinc-400/10 border-zinc-400/20">
                          Dismissed
                        </span>
                      )}
                      <span className="text-xs text-zinc-500">{formatTime(item.createdAt)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <div ref={menuRef} className="relative">
                      <button
                        onClick={() => setMenuOpen((o) => !o)}
                        className="p-1.5 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
                      >
                        <DotsThree size={16} weight="bold" />
                      </button>
                      {menuOpen && (
                        <div className="absolute right-0 top-full mt-1 w-40 rounded-lg border border-zinc-800 bg-zinc-900 shadow-xl py-1 z-50 motion-preset-fade motion-preset-slide-down-sm motion-duration-150">
                          <button
                            onClick={() => { setConfirmDismiss(true); setMenuOpen(false); }}
                            className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors text-left"
                          >
                            <EyeSlash size={14} />
                            Dismiss
                          </button>
                          <button
                            onClick={() => { setConfirmDelete(true); setMenuOpen(false); }}
                            className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-red-400 hover:text-red-300 hover:bg-zinc-800 transition-colors text-left"
                          >
                            <Trash size={14} />
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                    <Drawer.Close className="p-1.5 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors">
                      <X size={16} weight="bold" />
                    </Drawer.Close>
                  </div>
                </div>

                {/* Description */}
                {item.description && (
                  <Drawer.Description render={<div />} className="shrink-0 px-5 py-4 border-b border-zinc-800/50">
                    <CollapsibleContent maxHeight={80}>
                      <Markdown>{item.description}</Markdown>
                    </CollapsibleContent>
                  </Drawer.Description>
                )}

                {/* Agent note */}
                {item.note && <AgentNote note={item.note} />}

                {/* Comments thread */}
                <CommentThread itemId={item.id} />
              </Drawer.Content>
            </Drawer.Popup>
          </Drawer.Viewport>
        </Drawer.Portal>
      </Drawer.Root>

      {/* Confirm dialogs */}
      <AlertDialog.Root open={confirmDismiss} onOpenChange={setConfirmDismiss}>
        <AlertDialog.Portal>
          <AlertDialog.Backdrop className={backdropCls} />
          <AlertDialog.Viewport className="fixed inset-0 z-[60] grid place-items-center px-4">
            <AlertDialog.Popup className={popupCls}>
              <AlertDialog.Title className="text-base font-semibold text-zinc-100 mb-1">
                Dismiss this item?
              </AlertDialog.Title>
              <AlertDialog.Description className="text-sm text-zinc-400 mb-6">
                This will mark the item as dismissed and move it to Done.
              </AlertDialog.Description>
              <div className="flex justify-end gap-2">
                <AlertDialog.Close className="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 transition-colors">
                  Cancel
                </AlertDialog.Close>
                <AlertDialog.Close
                  onClick={onDismiss}
                  className="rounded-md bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-900 hover:bg-zinc-200 transition-colors"
                >
                  Dismiss
                </AlertDialog.Close>
              </div>
            </AlertDialog.Popup>
          </AlertDialog.Viewport>
        </AlertDialog.Portal>
      </AlertDialog.Root>

      <AlertDialog.Root open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialog.Portal>
          <AlertDialog.Backdrop className={backdropCls} />
          <AlertDialog.Viewport className="fixed inset-0 z-[60] grid place-items-center px-4">
            <AlertDialog.Popup className={popupCls}>
              <AlertDialog.Title className="text-base font-semibold text-zinc-100 mb-1">
                Delete this item?
              </AlertDialog.Title>
              <AlertDialog.Description className="text-sm text-zinc-400 mb-6">
                This action cannot be undone.
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
    </>
  );
}

// ── Comment thread ──────────────────────────────────────────────────────────

function AgentNote({ note }: { note: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="shrink-0 border-b border-zinc-800/50">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 w-full px-5 py-3 text-xs font-medium text-zinc-500 hover:text-zinc-300 transition-colors"
      >
        <CaretRight
          size={12}
          weight="bold"
          className={`transition-transform duration-150 ${open ? "rotate-90" : ""}`}
        />
        Agent scratchpad
      </button>
      {open && (
        <div className="px-5 pb-4">
          <Markdown>{note}</Markdown>
        </div>
      )}
    </div>
  );
}

function CollapsibleContent({ children, maxHeight = 200 }: { children: React.ReactNode; maxHeight?: number }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const check = useCallback(() => {
    if (!contentRef.current) return;
    setIsOverflowing(contentRef.current.scrollHeight > maxHeight);
  }, [maxHeight]);

  useEffect(() => {
    check();
    const ro = new ResizeObserver(check);
    if (contentRef.current) ro.observe(contentRef.current);
    return () => ro.disconnect();
  }, [check]);

  return (
    <div className="relative">
      <div
        ref={contentRef}
        className="overflow-hidden transition-[max-height] duration-200"
        style={{ maxHeight: expanded ? contentRef.current?.scrollHeight : maxHeight }}
      >
        {children}
      </div>
      {isOverflowing && !expanded && (
        <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-zinc-950 to-transparent flex items-end justify-center pb-1">
          <button
            onClick={() => setExpanded(true)}
            className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            Show more
          </button>
        </div>
      )}
      {isOverflowing && expanded && (
        <button
          onClick={() => setExpanded(false)}
          className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors mt-1"
        >
          Show less
        </button>
      )}
    </div>
  );
}

function CommentThread({ itemId }: { itemId: string }) {
  const comments = trpc.monitor.listComments.useQuery({ monitorItemId: itemId });
  const utils = trpc.useUtils();
  const addComment = trpc.monitor.addComment.useMutation({
    onSuccess: () => {
      utils.monitor.listComments.invalidate({ monitorItemId: itemId });
      setDraft("");
    },
  });
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    addComment.mutate({ monitorItemId: itemId, content: draft.trim() });
  };

  return (
    <>
      {/* Messages */}
      <div className="px-5 py-4 space-y-4">
        {comments.data?.length === 0 && (
          <p className="text-sm text-zinc-500 text-center py-8">
            No comments yet. Leave a note to guide the agent's investigation.
          </p>
        )}
        {comments.data?.map((c) => (
          <div key={c.id} className="flex gap-3">
            <div className={`size-6 shrink-0 rounded-full flex items-center justify-center mt-0.5 ${
              c.source === "agent"
                ? "bg-violet-500/15 text-violet-400"
                : "bg-zinc-800 text-zinc-400"
            }`}>
              {c.source === "agent"
                ? <Robot size={13} weight="bold" />
                : <User size={13} weight="bold" />
              }
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-medium text-zinc-300">
                  {c.source === "agent" ? "Agent" : "You"}
                </span>
                <span className="text-xs text-zinc-600">{formatTime(c.createdAt)}</span>
              </div>
              <CollapsibleContent maxHeight={200}>
                <Markdown>{c.content}</Markdown>
              </CollapsibleContent>
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="sticky bottom-0 border-t border-zinc-800 bg-zinc-950 px-5 py-3 flex items-end gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmit(e);
            }
          }}
          placeholder="Add a comment..."
          rows={1}
          className="flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-zinc-500 resize-none"
        />
        <button
          type="submit"
          disabled={!draft.trim() || addComment.isPending}
          className="shrink-0 p-2 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-zinc-400"
        >
          <PaperPlaneTilt size={16} weight="bold" />
        </button>
      </form>
    </>
  );
}
