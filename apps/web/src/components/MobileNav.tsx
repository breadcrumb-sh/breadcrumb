import { CaretDown, Check } from "@phosphor-icons/react";
import { Link, useRouterState } from "@tanstack/react-router";
import { Menu } from "@base-ui/react/menu";
import { useSubMenu } from "./SubMenuContext";

const TABS = [
  { label: "Overview", path: "" },
  { label: "Traces", path: "/traces" },
  { label: "Explore", path: "/explore" },
  { label: "Settings", path: "/settings" },
] as const;

const menuPopupCls =
  "rounded-lg border border-zinc-800 bg-zinc-900 py-1 shadow-xl min-w-[160px] outline-none";

const menuItemCls =
  "flex w-full items-center gap-2.5 px-3 py-2 text-sm outline-none cursor-default data-[highlighted]:bg-zinc-800 transition-colors";

export function MobileNav({ projectId }: { projectId: string }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const subMenu = useSubMenu();

  const basePath = `/projects/${projectId}`;
  const activeTab =
    TABS.find(
      (t) => t.path !== "" && pathname.startsWith(`${basePath}${t.path}`)
    ) ?? TABS[0];

  return (
    <div className="flex items-center gap-1 px-4 py-2 text-sm sm:hidden border-b border-zinc-800/70">
      {/* Main tab menu */}
      <Menu.Root>
        <Menu.Trigger className="flex items-center gap-1 rounded-md px-2 py-1.5 font-medium text-zinc-200 hover:bg-zinc-800 transition-colors">
          {activeTab.label}
          <CaretDown size={12} weight="bold" className="text-zinc-500" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner sideOffset={4} align="start">
            <Menu.Popup className={menuPopupCls}>
              {TABS.map((tab) => {
                const isActive = tab === activeTab;
                return (
                  <Menu.Item
                    key={tab.label}
                    closeOnClick
                    render={
                      <Link
                        to={`/projects/$projectId${tab.path}`}
                        params={{ projectId }}
                      />
                    }
                    className={`${menuItemCls} ${
                      isActive ? "text-zinc-100" : "text-zinc-400"
                    }`}
                  >
                    <span className="w-4 flex justify-center">
                      {isActive && (
                        <Check size={12} weight="bold" className="text-zinc-100" />
                      )}
                    </span>
                    {tab.label}
                  </Menu.Item>
                );
              })}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>

      {/* Submenu — dropdown or action button */}
      {subMenu && subMenu.type === "action" ? (
        <>
          <span className="text-zinc-700 select-none">/</span>
          <button
            onClick={subMenu.onClick}
            className="flex items-center gap-1.5 rounded-md px-2 py-1.5 font-medium text-zinc-200 hover:bg-zinc-800 transition-colors"
          >
            {subMenu.icon}
            {subMenu.label}
          </button>
        </>
      ) : subMenu && (!subMenu.type || subMenu.type === "dropdown") && subMenu.items.length > 0 ? (
        <>
          <span className="text-zinc-700 select-none">/</span>
          <Menu.Root>
            <Menu.Trigger className="flex items-center gap-1 rounded-md px-2 py-1.5 font-medium text-zinc-200 hover:bg-zinc-800 transition-colors">
              {subMenu.items.find((i) => i.id === subMenu.activeId)?.label ??
                subMenu.items[0].label}
              <CaretDown size={12} weight="bold" className="text-zinc-500" />
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Positioner sideOffset={4} align="start">
                <Menu.Popup className={menuPopupCls}>
                  {subMenu.items.map((item) => {
                    const isActive = item.id === subMenu.activeId;
                    return (
                      <Menu.Item
                        key={item.id}
                        closeOnClick
                        onClick={() => subMenu.setActiveId(item.id)}
                        className={`${menuItemCls} ${
                          isActive ? "text-zinc-100" : "text-zinc-400"
                        }`}
                      >
                        <span className="w-4 flex justify-center">
                          {isActive && (
                            <Check
                              size={12}
                              weight="bold"
                              className="text-zinc-100"
                            />
                          )}
                        </span>
                        {item.icon}
                        {item.label}
                      </Menu.Item>
                    );
                  })}
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
        </>
      ) : null}
    </div>
  );
}
