import { CaretDown } from "@phosphor-icons/react/CaretDown";
import { useState } from "react";
import type { Icon } from "@phosphor-icons/react";

// ── Types ───────────────────────────────────────────────────────────────────

export type NavSubItem = {
  label: string;
  id?: string;
  children?: NavSubItem[];
  /** When true, render a small red dot next to the label. Used for
   * "needs attention" indicators (e.g. unset model rates). */
  badge?: boolean;
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
  /** Same semantics as NavSubItem.badge — bubbles up from a child so the
   * indicator stays visible when the group is collapsed. */
  badge?: boolean;
};

export type NavEntry = NavLeafItem | NavGroupItem;

// ── Sub-items (recursive) ───────────────────────────────────────────────────

function SubItems({
  items,
  activeId,
  onSelect,
  openSections,
  toggleSection,
  depth,
}: {
  items: NavSubItem[];
  activeId: string;
  onSelect: (id: string) => void;
  openSections: Set<string>;
  toggleSection: (label: string) => void;
  depth: number;
}) {
  return (
    <>
      {items.map((child) => {
        // Nested group (has children)
        if (child.children && child.children.length > 0) {
          const isOpen = openSections.has(child.label);
          const hasActiveChild = child.children.some(
            (c) => c.id === activeId || c.children?.some((gc) => gc.id === activeId),
          );

          return (
            <div key={child.label}>
              <button
                onClick={() => toggleSection(child.label)}
                className={`
                  flex cursor-pointer items-center gap-2 w-full text-left rounded-md px-2.5 py-1.5 text-[12px]
                  transition-colors duration-150
                  ${hasActiveChild
                    ? "text-zinc-200"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/30"
                  }
                `}
              >
                <span className="flex-1">{child.label}</span>
                <CaretDown
                  size={11}
                  className={`shrink-0 text-zinc-600 transition-transform duration-200 ${isOpen ? "" : "-rotate-90"}`}
                />
              </button>

              <div
                className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
                  isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                }`}
              >
                <div className="overflow-hidden">
                  <div className="mt-0.5 ml-4 border-l border-zinc-800 pl-2.5 space-y-0.5 pb-0.5">
                    <SubItems
                      items={child.children}
                      activeId={activeId}
                      onSelect={onSelect}
                      openSections={openSections}
                      toggleSection={toggleSection}
                      depth={depth + 1}
                    />
                  </div>
                </div>
              </div>
            </div>
          );
        }

        // Leaf item
        if (!child.id) return null;
        const isActive = activeId === child.id;
        return (
          <button
            key={child.id}
            onClick={() => onSelect(child.id!)}
            className={`
              relative cursor-pointer flex w-full items-center gap-2 text-left rounded-l-md px-2.5 py-1.5 text-[12px]
              transition-colors duration-150
              ${isActive
                ? "text-zinc-100 bg-zinc-800/40 font-medium border-r-2 border-r-zinc-100"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/30"
              }
            `}
          >
            <span className="flex-1">{child.label}</span>
            {child.badge && (
              <span
                aria-label="Needs attention"
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: "var(--color-viz-1)" }}
              />
            )}
          </button>
        );
      })}
    </>
  );
}

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
    <nav className="flex-1 pl-4 py-6 space-y-1 overflow-y-auto">
      {items.map((entry) => {
        const Icon = entry.icon;

        if (entry.kind === "leaf") {
          const isActive = activeId === entry.id;
          return (
            <button
              key={entry.id}
              onClick={() => onSelect(entry.id)}
              className={`
                relative cursor-pointer flex items-center gap-2.5 w-full rounded-l-md px-2 py-1.5 text-[12px]
                transition-colors duration-150
                ${isActive
                  ? "text-zinc-100 bg-zinc-800/40 font-medium border-r-2 border-zinc-100"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40"
                }
              `}
            >
              <Icon size={16} className={`shrink-0 ${isActive ? "text-zinc-200" : "text-zinc-500"}`} />
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
              className="flex cursor-pointer items-center gap-2.5 w-full rounded-l-md px-2 py-1.5 text-[12px] text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40 transition-colors duration-150"
            >
              <Icon size={16} className="shrink-0 text-zinc-500" />
              <span className="flex-1 text-left">{entry.label}</span>
              {entry.badge && !isOpen && (
                <span
                  aria-label="Needs attention"
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: "var(--color-viz-1)" }}
                />
              )}
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
                  <div className="mt-0.5 ml-4 border-l border-zinc-800 pl-2.5 space-y-0.5 pb-0.5">
                    <SubItems
                      items={entry.children}
                      activeId={activeId}
                      onSelect={onSelect}
                      openSections={openSections}
                      toggleSection={toggleSection}
                      depth={1}
                    />
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
