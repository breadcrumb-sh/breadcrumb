import { useCallback, useEffect, useRef, useState } from "react";
import { CaretDown } from "@phosphor-icons/react/CaretDown";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { Plus } from "@phosphor-icons/react/Plus";
import { MagicWandIcon } from "@phosphor-icons/react/MagicWand";
import { PriorityIcon, PRIORITIES } from "./priority";
import { trpc } from "../../lib/trpc";
import { COLUMNS, canTransition } from "./columns";
import { CreateItemDialog } from "./CreateItemDialog";
import { MonitorItemSheet } from "./MonitorItemSheet";
import type { MonitorItem, TaskStatus } from "./types";

// ── Collapsed columns (localStorage) ────────────────────────────────────────

const COLLAPSED_KEY = "kanban-collapsed";

function useCollapsedColumns() {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "{}"); } catch { return {}; }
  });
  const toggle = useCallback((colId: string) => {
    setCollapsed((prev) => {
      const next = { ...prev, [colId]: !prev[colId] };
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next));
      return next;
    });
  }, []);
  return { collapsed, toggle };
}

// ── Allowed drop transitions ────────────────────────────────────────────────

function canDrop(fromStatus: string, toStatus: TaskStatus): boolean {
  return canTransition(fromStatus, toStatus);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatRelativeTime(date: Date) {
  const now = Date.now();
  const ms = now - new Date(date).getTime();
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(date).toLocaleDateString();
}

// ── Draggable card ──────────────────────────────────────────────────────────

function DraggableCard({
  task,
  onOpen,
}: {
  task: MonitorItem;
  onOpen: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    data: task,
  });
  const cardContent = (
    <>
      {task.source === "agent" && (
        <div className="flex flex-row items-center gap-1.5">
          <MagicWandIcon size={14} className="text-muted-foreground" />
          <span className="text-muted-foreground text-xs">Auto-detected</span>
        </div>
      )}
      <p className={`text-sm leading-[1.4] transition-colors ${
        task.status === "done" ? "text-muted-foreground line-through" : "text-foreground hover:underline"
      }`}>
        {task.title}
      </p>
      <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
        {task.priority && task.priority !== "none" && (() => {
          const p = PRIORITIES.find((pr) => pr.value === task.priority);
          return p ? (
            <PriorityIcon level={p.value} className={`size-3.5 ${p.color}`} />
          ) : null;
        })()}
        {task.labels.map((label) => (
          <span
            key={label.id}
            className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] leading-none border border-zinc-700 bg-zinc-800/50"
          >
            <span className="size-1.5 rounded-full shrink-0" style={{ backgroundColor: label.color }} />
            {label.name}
          </span>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {formatRelativeTime(task.createdAt)}
      </p>
    </>
  );

  if (task.processing) {
    return (
      <div
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        onClick={onOpen}
        className={`relative rounded-lg p-px cursor-grab active:cursor-grabbing overflow-hidden ${isDragging ? "opacity-30" : ""}`}
      >
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 aspect-square w-[200%] animate-[spin_2.5s_linear_infinite]"
          style={{ background: "conic-gradient(from 0deg, rgba(255,255,255,0.1) 50%, rgba(255,255,255,0.25) 75%, rgba(255,255,255,0.5) 85%, rgba(255,255,255,0.25) 92%, rgba(255,255,255,0.1) 100%)" }}
        />
        <div className="relative rounded-[calc(var(--radius-lg)-1px)] bg-zinc-900 p-3 flex flex-col gap-1.5 text-left">
          {cardContent}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={onOpen}
      className={`rounded-lg flex flex-col gap-1.5 border p-3 text-left transition-colors cursor-grab active:cursor-grabbing ${
        isDragging ? "opacity-30" : ""
      } ${task.read ? "border-zinc-800 bg-zinc-900 hover:border-zinc-700" : "border-blue-500/30 hover:border-blue-500/40 bg-blue-500/5"}`}
    >
      {cardContent}
    </div>
  );
}

// ── Droppable column ────────────────────────────────────────────────────────

function DroppableColumn({
  col,
  tasks,
  isValidTarget,
  isDragging,
  isCollapsed,
  onToggleCollapse,
  onOpenItem,
  onAdd,
}: {
  col: (typeof COLUMNS)[number];
  tasks: MonitorItem[];
  isValidTarget: boolean;
  isDragging: boolean;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onOpenItem: (task: MonitorItem) => void;
  onAdd?: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: col.id });

  const dimmed = isDragging && !isValidTarget;
  const highlighted = isDragging && isValidTarget;

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col shrink-0 rounded-lg p-3 transition-all duration-150 ${
        isCollapsed ? "w-auto min-w-0 h-fit" : "min-w-[280px] w-[320px] max-h-full"
      } ${dimmed ? "opacity-30" : ""} ${
        highlighted ? (isOver ? "bg-zinc-800/40" : "bg-zinc-800/20") : ""
      }`}
    >

      <div className="flex items-center justify-between h-7">
        <div className="flex items-center gap-2">
          <col.icon className={`size-4 shrink-0 ${col.dotColor}`} />
          <span className="text-sm font-medium text-zinc-100 leading-none">
            {col.title}
          </span>
          <span className="text-sm text-zinc-500 tabular-nums leading-none ml-1">
            {tasks.length}
          </span>
        </div>
        <div className="flex items-center gap-1 ml-2">
          {onAdd && !isCollapsed && (
            <button
              onClick={onAdd}
              className="p-1 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
            >
              <Plus size={16} weight="bold" />
            </button>
          )}
          <button
            onClick={onToggleCollapse}
            className="p-1 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
          >
            <CaretDown
              size={14}
              weight="bold"
              className={`transition-transform duration-150 ${isCollapsed ? "-rotate-90" : ""}`}
            />
          </button>
        </div>
      </div>

      {!isCollapsed && (
        <>
          <p className="text-xs text-zinc-500 mb-4">{col.description}</p>

          <div className="flex flex-col gap-2 overflow-y-auto min-h-0 flex-1">
            {tasks.map((task) => (
              <DraggableCard
                key={task.id}
                task={task}
                onOpen={() => onOpenItem(task)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Board ───────────────────────────────────────────────────────────────────

export function KanbanBoard({
  projectId,
  alignRef,
  selectedItemId,
  onSelectItem,
}: {
  projectId: string;
  alignRef?: React.RefObject<HTMLElement | null>;
  selectedItemId?: string;
  onSelectItem?: (id: string | null) => void;
}) {
  const items = trpc.monitor.list.useQuery({ projectId });
  const utils = trpc.useUtils();

  // SSE subscription for real-time updates
  trpc.monitor.onEvent.useSubscription({ projectId }, {
    onData: (tracked) => {
      const event = tracked.data;
      utils.monitor.list.invalidate({ projectId });
      if (event.type === "comment") {
        utils.monitor.listComments.invalidate({ monitorItemId: event.itemId });
      }
      utils.monitor.listActivity.invalidate({ monitorItemId: event.itemId });
    },
  });

  const updateItem = trpc.monitor.update.useMutation({
    onSuccess: () => utils.monitor.list.invalidate({ projectId }),
  });
  const deleteItem = trpc.monitor.delete.useMutation({
    onSuccess: () => {
      utils.monitor.list.invalidate({ projectId });
      setSelectedId(null);
    },
  });
  const investigate = trpc.monitor.investigate.useMutation({
    onSuccess: () => utils.monitor.list.invalidate({ projectId }),
  });

  const markRead = trpc.monitor.markRead.useMutation({
    onSuccess: () => utils.monitor.list.invalidate({ projectId }),
  });
  const setSelectedId = (id: string | null) => onSelectItem?.(id);
  const [addOpen, setAddOpen] = useState(false);
  const [activeItem, setActiveItem] = useState<MonitorItem | null>(null);
  const { collapsed, toggle: toggleCollapsed } = useCollapsedColumns();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [padLeft, setPadLeft] = useState<number | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  useEffect(() => {
    const measure = () => {
      if (!alignRef?.current || !scrollRef.current) return;
      const pad = alignRef.current.getBoundingClientRect().left - scrollRef.current.getBoundingClientRect().left;
      setPadLeft(Math.max(0, pad));
    };
    requestAnimationFrame(() => requestAnimationFrame(measure));
    const ro = new ResizeObserver(() => requestAnimationFrame(measure));
    if (scrollRef.current) ro.observe(scrollRef.current);
    if (alignRef?.current) ro.observe(alignRef.current);
    return () => ro.disconnect();
  }, [alignRef]);

  const tasks = items.data ?? [];
  const selectedItem = selectedItemId ? tasks.find((t) => t.id === selectedItemId) ?? null : null;

  function handleDragStart(event: DragStartEvent) {
    setActiveItem(event.active.data.current as MonitorItem);
  }

  function handleDragEnd(event: DragEndEvent) {
    const item = event.active.data.current as MonitorItem;
    const targetCol = event.over?.id as TaskStatus | undefined;
    setActiveItem(null);

    if (!targetCol || targetCol === item.status) return;
    if (!canDrop(item.status, targetCol)) return;

    // Optimistic update — move the item immediately in the cache
    utils.monitor.list.setData({ projectId }, (old) =>
      old?.map((t) => t.id === item.id ? { ...t, status: targetCol } : t),
    );

    if (targetCol === "investigating") {
      investigate.mutate({ id: item.id });
    } else {
      updateItem.mutate({ id: item.id, status: targetCol });
    }
  }

  return (
    <>
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div
          ref={scrollRef}
          className={`flex gap-2 overflow-x-auto pb-2 h-full min-h-0 pr-5 sm:pr-8 ${padLeft === null ? "invisible" : ""}`}
          style={{ paddingLeft: padLeft ?? 0 }}
        >
          {COLUMNS.map((col) => {
            const colTasks = tasks.filter((t) => t.status === col.id);
            const isValidTarget = activeItem
              ? canDrop(activeItem.status, col.id) && col.id !== activeItem.status
              : false;

            return (
              <DroppableColumn
                key={col.id}
                col={col}
                tasks={colTasks}
                isValidTarget={isValidTarget}
                isDragging={activeItem !== null}
                isCollapsed={!!collapsed[col.id]}
                onToggleCollapse={() => toggleCollapsed(col.id)}
                onOpenItem={(task) => {
                  setSelectedId(task.id);
                  if (!task.read) markRead.mutate({ id: task.id });
                }}
                onAdd={col.id === "queue" ? () => setAddOpen(true) : undefined}
              />
            );
          })}
        </div>

        <DragOverlay>
          {activeItem && (
            <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-3 w-[300px] shadow-xl opacity-90 rotate-2">
              <span className="text-sm text-zinc-200">{activeItem.title}</span>
            </div>
          )}
        </DragOverlay>
      </DndContext>

      <MonitorItemSheet
        item={selectedItem}
        open={selectedItem !== null}
        onOpenChange={(open) => { if (!open) setSelectedId(null); }}
        onDismiss={() => {
          if (selectedItem) {
            updateItem.mutate({ id: selectedItem.id, status: "done" });
            setSelectedId(null);
          }
        }}
        onDelete={() => {
          if (selectedItem) deleteItem.mutate({ id: selectedItem.id });
        }}
      />

      <CreateItemDialog
        projectId={projectId}
        open={addOpen}
        onOpenChange={setAddOpen}
      />
    </>
  );
}
