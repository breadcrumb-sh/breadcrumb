import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Drawer } from "@base-ui/react/drawer";
import { CaretRight } from "@phosphor-icons/react/CaretRight";
import { EyeSlash } from "@phosphor-icons/react/EyeSlash";
import { MagicWand } from "@phosphor-icons/react/MagicWand";
import { PaperPlaneTilt } from "@phosphor-icons/react/PaperPlaneTilt";
import { Plus } from "@phosphor-icons/react/Plus";
import { Robot } from "@phosphor-icons/react/Robot";
import { Trash } from "@phosphor-icons/react/Trash";
import { User } from "@phosphor-icons/react/User";
import { X } from "@phosphor-icons/react/X";
import { Markdown } from "../common/Markdown";
import { FadeOverlay } from "../common/ProgressiveBlur";
import { useAuth } from "../../hooks/useAuth";
import { trpc } from "../../lib/trpc";
import { backdropCls, popupCls } from "../settings/dialog-styles";
import { COLUMNS, ALLOWED_TRANSITIONS, statusInfo, formatTime } from "./columns";
import type { MonitorItem, TaskStatus } from "./types";

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
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!item) return null;

  return (
    <>
      <Drawer.Root open={open} onOpenChange={onOpenChange} swipeDirection="right">
        <Drawer.Portal>
          <Drawer.Backdrop className="monitor-drawer-backdrop" />
          <Drawer.Viewport className="monitor-drawer-viewport">
            <Drawer.Popup className="monitor-drawer-popup">
              <Drawer.Content className="flex flex-col h-full">
                {/* Header */}
                <SheetHeader item={item} />

                {/* Two-column body */}
                <div className="flex flex-1 min-h-0 overflow-hidden">
                  {/* Left: description, note, activity */}
                  <div className="flex-1 min-w-0 flex flex-col overflow-y-auto">
                    {/* Description */}
                    {item.description && (
                      <div className="px-5 py-4 border-b border-zinc-800/50">
                        <CollapsibleContent maxHeight={80}>
                          <Markdown>{item.description}</Markdown>
                        </CollapsibleContent>
                      </div>
                    )}

                    {/* Agent note */}
                    {item.note && <AgentNote note={item.note} />}

                    {/* Activity + Comments */}
                    <ActivitySection itemId={item.id} />
                  </div>

                  {/* Right sidebar */}
                  <Sidebar
                    item={item}
                    onDismiss={onDismiss}
                    onDelete={() => setConfirmDelete(true)}
                  />
                </div>
              </Drawer.Content>
            </Drawer.Popup>
          </Drawer.Viewport>
        </Drawer.Portal>
      </Drawer.Root>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this item?"
        description="This action cannot be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={onDelete}
      />
    </>
  );
}

// ── Header ──────────────────────────────────────────────────────────────

function SheetHeader({ item }: { item: MonitorItem }) {
  const { user: currentUser } = useAuth();

  const opener = item.source === "agent"
    ? null // auto-detected
    : item.createdById === currentUser?.id
      ? "you"
      : item.createdByName ?? "Unknown";

  return (
    <div className="shrink-0 bg-zinc-950 border-b border-zinc-800 px-5 py-4 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <Drawer.Title className="text-base font-semibold text-zinc-100">
          {item.title}
        </Drawer.Title>
        <p className="text-xs text-zinc-500 mt-1.5 flex items-center gap-1.5">
          {opener === null ? (
            <>
              <MagicWand size={12} className="text-zinc-500" />
              Automatically opened {formatTime(item.createdAt)}
            </>
          ) : (
            <>Opened by {opener} {formatTime(item.createdAt)}</>
          )}
        </p>
      </div>
      <Drawer.Close className="p-1.5 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors shrink-0">
        <X size={16} weight="bold" />
      </Drawer.Close>
    </div>
  );
}

// ── Right sidebar ───────────────────────────────────────────────────────

function PriorityIcon({ level, className = "" }: { level: string; className?: string }) {
  if (level === "critical") {
    return (
      <svg viewBox="0 0 16 16" className={`size-4 ${className}`} fill="none">
        <rect x="2" y="2" width="12" height="12" rx="2" fill="currentColor" opacity="0.2" />
        <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <line x1="8" y1="5" x2="8" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="8" cy="11" r="0.75" fill="currentColor" />
      </svg>
    );
  }
  // Bar chart icon — bars filled based on level
  const bars = level === "high" ? 3 : level === "medium" ? 2 : level === "low" ? 1 : 0;
  return (
    <svg viewBox="0 0 16 16" className={`size-4 ${className}`} fill="none">
      <rect x="2" y="10" width="3" height="4" rx="0.5" fill="currentColor" opacity={bars >= 1 ? 1 : 0.2} />
      <rect x="6.5" y="6.5" width="3" height="7.5" rx="0.5" fill="currentColor" opacity={bars >= 2 ? 1 : 0.2} />
      <rect x="11" y="3" width="3" height="11" rx="0.5" fill="currentColor" opacity={bars >= 3 ? 1 : 0.2} />
    </svg>
  );
}

const PRIORITIES = [
  { value: "none", label: "No priority", color: "text-zinc-500" },
  { value: "low", label: "Low", color: "text-zinc-400" },
  { value: "medium", label: "Medium", color: "text-amber-400" },
  { value: "high", label: "High", color: "text-orange-400" },
  { value: "critical", label: "Critical", color: "text-red-400" },
] as const;

function Sidebar({
  item,
  onDismiss,
  onDelete,
}: {
  item: MonitorItem;
  onDismiss: () => void;
  onDelete: () => void;
}) {
  const { label: statusText, dotColor, Icon: StatusIcon } = statusInfo(item.status);
  const utils = trpc.useUtils();

  const updateItem = trpc.monitor.update.useMutation({
    onSuccess: () => utils.monitor.list.invalidate({ projectId: item.projectId }),
  });
  const investigate = trpc.monitor.investigate.useMutation({
    onSuccess: () => utils.monitor.list.invalidate({ projectId: item.projectId }),
  });

  // Status
  const [statusOpen, setStatusOpen] = useState(false);
  const statusRef = useRef<HTMLDivElement>(null);
  const allowedStatuses = ALLOWED_TRANSITIONS[item.status as TaskStatus] ?? [];

  // Priority
  const [priorityOpen, setPriorityOpen] = useState(false);
  const priorityRef = useRef<HTMLDivElement>(null);
  const currentPriority = PRIORITIES.find((p) => p.value === item.priority) ?? PRIORITIES[0];

  // Close dropdowns on outside click
  useEffect(() => {
    if (!statusOpen && !priorityOpen) return;
    const handler = (e: MouseEvent) => {
      if (statusOpen && statusRef.current && !statusRef.current.contains(e.target as Node)) setStatusOpen(false);
      if (priorityOpen && priorityRef.current && !priorityRef.current.contains(e.target as Node)) setPriorityOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [statusOpen, priorityOpen]);

  // Labels
  const allLabels = trpc.labels.list.useQuery({ projectId: item.projectId });
  const itemLabels = trpc.labels.listForItem.useQuery({ projectId: item.projectId, monitorItemId: item.id });
  const setLabels = trpc.labels.setForItem.useMutation({
    onSuccess: () => utils.labels.listForItem.invalidate({ projectId: item.projectId, monitorItemId: item.id }),
  });
  const [labelsOpen, setLabelsOpen] = useState(false);

  const selectedLabelIds = new Set(itemLabels.data?.map((l) => l.id) ?? []);

  const toggleLabel = (labelId: string) => {
    const next = new Set(selectedLabelIds);
    if (next.has(labelId)) next.delete(labelId);
    else next.add(labelId);
    setLabels.mutate({ projectId: item.projectId, monitorItemId: item.id, labelIds: [...next] });
  };

  return (
    <div className="w-[280px] shrink-0 border-l border-zinc-800 overflow-y-auto">
      <div className="p-4 space-y-5">
        {/* Priority */}
        <div className="relative" ref={priorityRef}>
          <p className="text-xs font-medium text-zinc-500 mb-1.5">Priority</p>
          <button
            onClick={() => setPriorityOpen((o) => !o)}
            className={`flex items-center gap-2 text-sm rounded-md px-2 py-1 -mx-2 transition-colors hover:bg-zinc-800 ${currentPriority.color}`}
          >
            <PriorityIcon level={currentPriority.value} />
            {currentPriority.label}
          </button>
          {priorityOpen && (
            <div className="absolute left-0 top-full mt-1 w-44 rounded-lg border border-zinc-800 bg-zinc-900 shadow-xl py-1 z-50">
              {PRIORITIES.map((p) => (
                <button
                  key={p.value}
                  onClick={() => {
                    updateItem.mutate({ id: item.id, priority: p.value });
                    setPriorityOpen(false);
                  }}
                  className={`flex items-center gap-2.5 w-full px-3 py-1.5 text-sm hover:bg-zinc-800 transition-colors text-left ${p.color} ${item.priority === p.value ? "bg-zinc-800/50" : ""}`}
                >
                  <PriorityIcon level={p.value} />
                  <span className="flex-1">{p.label}</span>
                  {item.priority === p.value && (
                    <span className="text-zinc-400 text-xs">&#10003;</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Labels */}
        <LabelsPicker
          projectId={item.projectId}
          itemId={item.id}
          allLabels={allLabels.data ?? []}
          itemLabels={itemLabels.data ?? []}
          selectedLabelIds={selectedLabelIds}
          onToggle={toggleLabel}
        />

        {/* Linked traces */}
        {item.traceNames.length > 0 && (
          <div>
            <p className="text-xs font-medium text-zinc-500 mb-2">Linked traces</p>
            <div className="flex flex-wrap gap-1.5">
              {item.traceNames.map((name) => (
                <span
                  key={name}
                  className="text-xs px-2 py-0.5 rounded border border-zinc-700 bg-zinc-800/50 text-zinc-300 font-mono"
                >
                  {name}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Status */}
        <div className="relative" ref={statusRef}>
          <p className="text-xs font-medium text-zinc-500 mb-1.5">Status</p>
          <button
            onClick={() => setStatusOpen((o) => !o)}
            className="flex items-center gap-1.5 text-sm text-zinc-300 rounded-md px-2 py-1 -mx-2 transition-colors hover:bg-zinc-800"
          >
            <StatusIcon className={`size-3.5 ${dotColor}`} />
            {statusText}
          </button>
          {statusOpen && allowedStatuses.length > 0 && (
            <div className="absolute left-0 top-full mt-1 w-44 rounded-lg border border-zinc-800 bg-zinc-900 shadow-xl py-1 z-50">
              {allowedStatuses.map((s) => {
                const col = COLUMNS.find((c) => c.id === s);
                if (!col) return null;
                return (
                  <button
                    key={s}
                    onClick={() => {
                      if (s === "investigating") {
                        investigate.mutate({ id: item.id });
                      } else {
                        updateItem.mutate({ id: item.id, status: s });
                      }
                      setStatusOpen(false);
                    }}
                    className="flex items-center gap-2.5 w-full px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 transition-colors text-left"
                  >
                    <col.icon className={`size-3.5 ${col.dotColor}`} />
                    {col.title}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="border-t border-zinc-800/50 pt-4 space-y-1">
          {item.status !== "done" && (
            <button
              onClick={onDismiss}
              className="flex items-center gap-2.5 w-full px-2 py-1.5 rounded text-sm text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors text-left"
            >
              <EyeSlash size={14} />
              Dismiss
            </button>
          )}
          <button
            onClick={onDelete}
            className="flex items-center gap-2.5 w-full px-2 py-1.5 rounded text-sm text-red-400 hover:text-red-300 hover:bg-zinc-800 transition-colors text-left"
          >
            <Trash size={14} />
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Labels picker ───────────────────────────────────────────────────

const LABEL_COLORS = ["#ef4444", "#f59e0b", "#22c55e", "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899", "#6b7280"];

function LabelsPicker({
  projectId,
  itemId,
  allLabels,
  itemLabels,
  selectedLabelIds,
  onToggle,
}: {
  projectId: string;
  itemId: string;
  allLabels: Array<{ id: string; name: string; color: string }>;
  itemLabels: Array<{ id: string; name: string; color: string }>;
  selectedLabelIds: Set<string>;
  onToggle: (labelId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();

  const createLabel = trpc.labels.create.useMutation({
    onSuccess: (label) => {
      utils.labels.list.invalidate({ projectId });
      // Auto-apply the new label
      onToggle(label.id);
      setSearch("");
    },
  });

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const filtered = allLabels.filter((l) =>
    l.name.toLowerCase().includes(search.toLowerCase()),
  );
  const exactMatch = allLabels.some((l) => l.name.toLowerCase() === search.trim().toLowerCase());
  const canCreate = search.trim().length > 0 && !exactMatch;

  const handleCreate = () => {
    const color = LABEL_COLORS[allLabels.length % LABEL_COLORS.length];
    createLabel.mutate({ projectId, name: search.trim(), color });
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <p className="text-xs font-medium text-zinc-500 mb-1.5">Labels</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {itemLabels.map((label) => (
          <span
            key={label.id}
            className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full border border-zinc-700 bg-zinc-800/50"
          >
            <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: label.color }} />
            {label.name}
          </span>
        ))}
        <button
          onClick={() => setOpen((o) => !o)}
          className="size-6 rounded-full flex items-center justify-center text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
        >
          <Plus size={14} weight="bold" />
        </button>
      </div>
      {open && (
        <div className="absolute left-0 top-full mt-1 w-52 rounded-lg border border-zinc-800 bg-zinc-900 shadow-xl z-50 overflow-hidden">
          <div className="px-2 py-1.5 border-b border-zinc-800">
            <input
              ref={inputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canCreate) handleCreate();
                if (e.key === "Escape") { setOpen(false); setSearch(""); }
              }}
              placeholder="Search or create..."
              className="w-full bg-transparent text-sm text-zinc-100 placeholder-zinc-500 outline-none"
            />
          </div>
          <div className="max-h-48 overflow-y-auto py-1">
            {filtered.map((label) => (
              <button
                key={label.id}
                onClick={() => onToggle(label.id)}
                className="flex items-center gap-2.5 w-full px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 transition-colors text-left"
              >
                <span className="size-2.5 rounded-full shrink-0" style={{ backgroundColor: label.color }} />
                <span className="flex-1">{label.name}</span>
                {selectedLabelIds.has(label.id) && (
                  <span className="text-zinc-400 text-xs">&#10003;</span>
                )}
              </button>
            ))}
            {canCreate && (
              <button
                onClick={handleCreate}
                className="flex items-center gap-2.5 w-full px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors text-left"
              >
                <Plus size={12} weight="bold" />
                <span>Create "{search.trim()}"</span>
              </button>
            )}
            {filtered.length === 0 && !canCreate && (
              <p className="px-3 py-2 text-xs text-zinc-500">No labels found</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Activity section (interleaved comments + activity events) ───────────

type ActivityEntry =
  | { kind: "comment"; id: string; source: string; authorId: string | null; authorName: string | null; content: string; createdAt: Date }
  | { kind: "activity"; id: string; type: string; fromStatus?: string | null; toStatus?: string | null; actor: string; actorId: string | null; actorName: string | null; createdAt: Date };

function ActivitySection({ itemId }: { itemId: string }) {
  const comments = trpc.monitor.listComments.useQuery({ monitorItemId: itemId });
  const activity = trpc.monitor.listActivity.useQuery({ monitorItemId: itemId });
  const { user: currentUser } = useAuth();
  const utils = trpc.useUtils();
  const addComment = trpc.monitor.addComment.useMutation({
    onSuccess: () => {
      utils.monitor.listComments.invalidate({ monitorItemId: itemId });
      setDraft("");
    },
  });
  const [draft, setDraft] = useState("");

  const entries = useMemo(() => {
    const items: ActivityEntry[] = [];
    for (const c of comments.data ?? []) {
      items.push({ kind: "comment", id: c.id, source: c.source, authorId: c.authorId, authorName: c.authorName, content: c.content, createdAt: c.createdAt });
    }
    for (const a of activity.data ?? []) {
      items.push({ kind: "activity", id: a.id, type: a.type, fromStatus: a.fromStatus, toStatus: a.toStatus, actor: a.actor, actorId: a.actorId, actorName: a.actorName, createdAt: a.createdAt });
    }
    items.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    return items;
  }, [comments.data, activity.data]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    addComment.mutate({ monitorItemId: itemId, content: draft.trim() });
  };

  return (
    <>
      <div className="px-5 pt-5 pb-2">
        <h3 className="text-sm font-semibold text-zinc-200">Activity</h3>
      </div>

      <div className="flex-1 px-5 pb-4">
        {entries.length === 0 && (
          <p className="text-sm text-zinc-500 text-center py-8">
            No activity yet.
          </p>
        )}

        <div className="relative">
          {/* Timeline line */}
          {entries.length > 0 && (
            <div className="absolute left-[11px] top-3 bottom-3 w-px bg-zinc-800" />
          )}

          <div className="space-y-0">
            {entries.map((entry) =>
              entry.kind === "activity" ? (
                <ActivityEvent key={entry.id} event={entry} currentUserId={currentUser?.id} />
              ) : (
                <CommentEntry key={entry.id} comment={entry} currentUserId={currentUser?.id} />
              ),
            )}
          </div>
        </div>
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="shrink-0 border-t border-zinc-800 bg-zinc-950 px-5 py-3 flex items-end gap-2">
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

function resolveActorName(actor: string, actorId: string | null, actorName: string | null, currentUserId?: string): string {
  if (actor === "agent") return "Agent";
  if (actor === "system") return "System";
  if (actorId && actorId === currentUserId) return "You";
  return actorName ?? "Unknown";
}

function activityLabel(event: ActivityEntry & { kind: "activity" }, currentUserId?: string): string {
  const actor = resolveActorName(event.actor, event.actorId, event.actorName, currentUserId);
  switch (event.type) {
    case "created":
      return `${actor} created this item`;
    case "status_change": {
      const from = statusInfo(event.fromStatus ?? "").label;
      const to = statusInfo(event.toStatus ?? "").label;
      return `${actor} moved from ${from} to ${to}`;
    }
    case "processing_started":
      return `${actor} started investigating`;
    case "processing_finished":
      return `${actor} finished investigating`;
    default:
      return `${actor} ${event.type}`;
  }
}

function ActivityEvent({ event, currentUserId }: { event: ActivityEntry & { kind: "activity" }; currentUserId?: string }) {
  const { Icon, dotColor } = event.toStatus
    ? statusInfo(event.toStatus)
    : { Icon: null, dotColor: "text-zinc-400" };

  return (
    <div className="flex items-center gap-3 py-1.5 relative">
      <div className={`size-[22px] shrink-0 rounded-full flex items-center justify-center bg-zinc-950 z-10 ${dotColor}`}>
        {Icon ? <Icon className="size-3.5" /> : (
          <div className="size-1.5 rounded-full bg-zinc-500" />
        )}
      </div>
      <span className="text-xs text-zinc-500">
        {activityLabel(event, currentUserId)}
      </span>
      <span className="text-xs text-zinc-600 ml-auto shrink-0">
        {formatTime(event.createdAt)}
      </span>
    </div>
  );
}

function CommentEntry({ comment, currentUserId }: { comment: ActivityEntry & { kind: "comment" }; currentUserId?: string }) {
  const authorLabel = comment.source === "agent"
    ? "Agent"
    : (comment.authorId && comment.authorId === currentUserId)
      ? "You"
      : comment.authorName ?? "Unknown";

  return (
    <div className="relative py-2">
      <div className="flex items-start gap-3">
        <div className={`size-[22px] shrink-0 rounded-full flex items-center justify-center bg-zinc-950 z-10 mt-1.5 ${
          comment.source === "agent" ? "text-violet-400" : "text-zinc-500"
        }`}>
          {comment.source === "agent"
            ? <Robot size={13} weight="bold" />
            : <User size={13} weight="bold" />
          }
        </div>
        <div className="min-w-0 flex-1 rounded-lg border border-zinc-800 bg-zinc-900" style={{ "--fade-color": "var(--color-zinc-900)" } as React.CSSProperties}>
          <div className="flex items-center gap-2 px-3 h-[34px] border-b border-zinc-800/50">
            <span className="text-xs font-medium text-zinc-300">
              {authorLabel}
            </span>
            <span className="text-xs text-zinc-600">{formatTime(comment.createdAt)}</span>
          </div>
          <div className="px-3 py-2.5">
            <CollapsibleContent maxHeight={200}>
              <Markdown>{comment.content}</Markdown>
            </CollapsibleContent>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────

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
        <>
          <FadeOverlay />
          <div className="absolute bottom-0 left-0 right-0 flex items-end justify-center pb-1 z-10">
            <button
              onClick={() => setExpanded(true)}
              className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              Show more
            </button>
          </div>
        </>
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

function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className={backdropCls} />
        <AlertDialog.Viewport className="fixed inset-0 z-[60] grid place-items-center px-4">
          <AlertDialog.Popup className={popupCls}>
            <AlertDialog.Title className="text-base font-semibold text-zinc-100 mb-1">
              {title}
            </AlertDialog.Title>
            <AlertDialog.Description className="text-sm text-zinc-400 mb-6">
              {description}
            </AlertDialog.Description>
            <div className="flex justify-end gap-2">
              <AlertDialog.Close className="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 transition-colors">
                Cancel
              </AlertDialog.Close>
              <AlertDialog.Close
                onClick={onConfirm}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  destructive
                    ? "bg-red-600 text-white hover:bg-red-700"
                    : "bg-zinc-100 text-zinc-900 hover:bg-zinc-200"
                }`}
              >
                {confirmLabel}
              </AlertDialog.Close>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Viewport>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
