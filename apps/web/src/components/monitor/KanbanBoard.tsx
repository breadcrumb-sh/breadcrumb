import { useEffect, useRef, useState } from "react";
import { Plus } from "@phosphor-icons/react/Plus";
import { trpc } from "../../lib/trpc";
import { COLUMNS } from "./columns";
import { CreateItemDialog } from "./CreateItemDialog";
import { MonitorItemSheet } from "./MonitorItemSheet";
import type { MonitorItem } from "./types";

export function KanbanBoard({
  projectId,
  alignRef,
}: {
  projectId: string;
  alignRef?: React.RefObject<HTMLElement | null>;
}) {
  const items = trpc.monitor.list.useQuery({ projectId });
  const utils = trpc.useUtils();

  const updateItem = trpc.monitor.update.useMutation({
    onSuccess: () => utils.monitor.list.invalidate({ projectId }),
  });
  const deleteItem = trpc.monitor.delete.useMutation({
    onSuccess: () => {
      utils.monitor.list.invalidate({ projectId });
      setSelectedItem(null);
    },
  });

  const [selectedItem, setSelectedItem] = useState<MonitorItem | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [padLeft, setPadLeft] = useState<number | null>(null);

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

  return (
    <>
      <div
        ref={scrollRef}
        className={`flex gap-6 overflow-x-auto pb-2 h-full min-h-0 pr-5 sm:pr-8 ${padLeft === null ? "invisible" : ""}`}
        style={{ paddingLeft: padLeft ?? 0 }}
      >
        {COLUMNS.map((col) => {
          const colTasks = tasks.filter((t) => t.status === col.id);
          return (
            <div
              key={col.id}
              className="flex flex-col min-w-[280px] w-[320px] shrink-0 max-h-full"
            >
              <div className="flex items-center justify-between h-7">
                <div className="flex items-center gap-2">
                  <col.icon className={`size-4 shrink-0 ${col.dotColor}`} />
                  <span className="text-sm font-medium text-zinc-100 leading-none">
                    {col.title}
                  </span>
                  <span className="text-sm text-zinc-500 tabular-nums leading-none ml-1">
                    {colTasks.length}
                  </span>
                </div>
                {col.id === "queue" && (
                  <button
                    onClick={() => setAddOpen(true)}
                    className="p-1 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
                  >
                    <Plus size={16} weight="bold" />
                  </button>
                )}
              </div>

              <p className="text-xs text-zinc-500 mb-4">{col.description}</p>

              <div className="flex flex-col gap-2 overflow-y-auto min-h-0 flex-1">
                {colTasks.map((task) => (
                  <div
                    key={task.id}
                    className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-left hover:border-zinc-700 transition-colors"
                  >
                    <button
                      onClick={() => setSelectedItem(task)}
                      className="text-sm text-zinc-200 hover:text-zinc-100 hover:underline transition-colors text-left"
                    >
                      {task.title}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <MonitorItemSheet
        item={selectedItem}
        open={selectedItem !== null}
        onOpenChange={(open) => { if (!open) setSelectedItem(null); }}
        onDismiss={() => {
          if (selectedItem) {
            updateItem.mutate({ id: selectedItem.id, dismissed: true, status: "done" });
            setSelectedItem(null);
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
