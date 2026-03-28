import { CaretDown } from "@phosphor-icons/react/CaretDown";
import { type ReactNode, useState } from "react";
import type { Icon } from "@phosphor-icons/react";

// ── Types ───────────────────────────────────────────────────────────────────

export type NavSubItem = {
  label: string;
  id: string;
};

export type NavLeafItem = {
  kind: "leaf";
  label: string;
  icon: Icon;
  id: string;
};

export type NavGroupItem = {
  kind: "group";
  label: string;
  icon: Icon;
  children: NavSubItem[];
};

export type NavEntry = NavLeafItem | NavGroupItem;

// ── Component ───────────────────────────────────────────────────────────────

export function SidebarNav({
  items,
  activeId,
  onSelect,
  defaultOpen,
}: {
  items: NavEntry[];
  /** The currently active item id (leaf id or sub-item id). */
  activeId: string;
  onSelect: (id: string) => void;
  /** Group labels that start expanded. */
  defaultOpen?: string[];
}) {
  const [openSections, setOpenSections] = useState<Set<string>>(
    () => new Set(defaultOpen ?? []),
  );

  const toggleSection = (label: string) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  return (
    <nav className="flex-1 px-2.5 py-3 space-y-1 overflow-y-auto">
      {items.map((entry) => {
        const Icon = entry.icon;

        if (entry.kind === "leaf") {
          const isActive = activeId === entry.id;
          return (
            <button
              key={entry.id}
              onClick={() => onSelect(entry.id)}
              className={`
                flex items-center gap-2.5 w-full rounded-md px-3 py-1.5 text-[13px]
                transition-colors duration-150
                ${isActive
                  ? "text-zinc-100 bg-zinc-800/40 font-medium"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40"
                }
              `}
            >
              <Icon size={16} className={`shrink-0 ${isActive ? "text-zinc-300" : "text-zinc-500"}`} />
              {entry.label}
            </button>
          );
        }

        // Group
        const isOpen = openSections.has(entry.label);
        return (
          <div key={entry.label}>
            <button
              onClick={() => toggleSection(entry.label)}
              className="flex items-center gap-2.5 w-full rounded-md px-3 py-1.5 text-[13px] text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40 transition-colors duration-150"
            >
              <Icon size={16} className="shrink-0 text-zinc-500" />
              <span className="flex-1 text-left">{entry.label}</span>
              <CaretDown
                size={12}
                className={`shrink-0 text-zinc-600 transition-transform duration-200 ${isOpen ? "" : "-rotate-90"}`}
              />
            </button>

            {entry.children.length > 0 && (
              <div
                className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
                  isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                }`}
              >
                <div className="overflow-hidden">
                  <div className="mt-0.5 ml-[19px] border-l border-zinc-800 pl-2.5 space-y-0.5 pb-0.5">
                    {entry.children.map((child) => {
                      const isChildActive = activeId === child.id;
                      return (
                        <button
                          key={child.id}
                          onClick={() => onSelect(child.id)}
                          className={`
                            block w-full text-left rounded-md px-2.5 py-1.5 text-[13px]
                            transition-colors duration-150
                            ${isChildActive
                              ? "text-zinc-100 bg-zinc-800/40 font-medium"
                              : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/30"
                            }
                          `}
                        >
                          {child.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
