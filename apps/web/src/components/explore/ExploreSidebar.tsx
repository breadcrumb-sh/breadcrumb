import { Plus } from "@phosphor-icons/react/Plus";
import { X } from "@phosphor-icons/react/X";

// ── Date grouping helper ────────────────────────────────────────────────────

export function groupByDate<T extends { updatedAt: Date | string }>(
  items: T[],
): { label: string; items: T[] }[] {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  const last7 = new Date(todayStart);
  last7.setDate(last7.getDate() - 7);
  const last30 = new Date(todayStart);
  last30.setDate(last30.getDate() - 30);

  const buckets: Record<string, T[]> = {};
  const order = ["Today", "Yesterday", "Last 7 days", "Last 30 days", "Older"];
  for (const label of order) buckets[label] = [];

  for (const item of items) {
    const d =
      item.updatedAt instanceof Date
        ? item.updatedAt
        : new Date(item.updatedAt);
    if (d >= todayStart) buckets["Today"].push(item);
    else if (d >= yesterdayStart) buckets["Yesterday"].push(item);
    else if (d >= last7) buckets["Last 7 days"].push(item);
    else if (d >= last30) buckets["Last 30 days"].push(item);
    else buckets["Older"].push(item);
  }

  return order
    .filter((label) => buckets[label].length > 0)
    .map((label) => ({ label, items: buckets[label] }));
}

// ── Sidebar component ────────────────────────────────────────────────────────

export interface ExploreSidebarProps {
  groups: { label: string; items: { id: string; name: string }[] }[];
  currentExploreId: string | undefined;
  onNewChat: () => void;
  onSelectChat: (id: string) => void;
  onDeleteChat: (id: string) => void;
  isViewer: boolean;
}

export function ExploreSidebar({
  groups,
  currentExploreId,
  onNewChat,
  onSelectChat,
  onDeleteChat,
  isViewer,
}: ExploreSidebarProps) {
  return (
    <>
      {!isViewer && (
        <div className="p-3">
          <button
            onClick={onNewChat}
            className="flex items-center gap-1.5 w-full px-3 py-1.5 rounded-md text-sm font-medium text-zinc-300 hover:bg-zinc-800 transition-colors"
          >
            <Plus size={14} />
            New chat
          </button>
        </div>
      )}
      <nav className="px-2 pb-4">
        {groups.map((group) => (
          <div key={group.label}>
            <p className="px-2 pt-3 pb-1 text-[11px] font-medium text-zinc-500 uppercase tracking-wide">
              {group.label}
            </p>
            {group.items.map((item) => (
              <button
                key={item.id}
                onClick={() => onSelectChat(item.id)}
                className={`group flex items-center justify-between w-full px-2 py-1.5 rounded-md text-sm transition-colors ${
                  item.id === currentExploreId
                    ? "bg-zinc-800/50 text-zinc-100"
                    : "text-zinc-400 hover:bg-zinc-800/30 hover:text-zinc-200"
                }`}
              >
                <span className="truncate">{item.name}</span>
                {!isViewer && (
                  <X
                    size={14}
                    className="shrink-0 opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-zinc-300 transition-opacity"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteChat(item.id);
                    }}
                  />
                )}
              </button>
            ))}
          </div>
        ))}
      </nav>
    </>
  );
}
