import { Link } from "@tanstack/react-router";
import { List } from "@phosphor-icons/react/List";
import { X } from "@phosphor-icons/react/X";
import { type ReactNode, useState } from "react";
import { Logo } from "../common/logo/Logo";
import { OrgSwitcher } from "./OrgSwitcher";
import { AppHeader } from "./AppHeader";
import { SidebarFooter } from "./SidebarFooter";

/**
 * Full page shell with sidebar + header + scrollable content area.
 * Used by both project layout and org settings.
 */
export function PageShell({
  orgId,
  orgName,
  logoTo,
  sidebar,
  header,
  children,
}: {
  orgId?: string;
  orgName?: string;
  /** Where the logo links to. Defaults to org page or "/". */
  logoTo?: string;
  /** Sidebar nav content (rendered inside the sidebar below the header). */
  sidebar: ReactNode;
  /** Header left-side content (switchers, breadcrumbs). */
  header: ReactNode;
  children: ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem("sidebar-collapsed") === "true"; } catch { return false; }
  });
  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const next = !c;
      try { localStorage.setItem("sidebar-collapsed", String(next)); } catch {}
      return next;
    });
  };
  const linkTo = logoTo ?? (orgId ? "/org/$orgId" : "/");
  const linkParams = orgId ? { orgId } : {};

  const sidebarHeader = (
    <div className="h-[52px] flex items-center gap-2.5 px-4 border-b border-zinc-800/70">
      <Link
        to={linkTo}
        params={linkParams}
        className="flex items-center hover:opacity-80 transition-opacity shrink-0"
      >
        <Logo className="size-5" />
      </Link>
      <OrgSwitcher currentOrgId={orgId} currentOrgName={orgName} />
    </div>
  );

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Desktop sidebar */}
      <aside
        className={`hidden sm:flex shrink-0 flex-col border-r border-zinc-800/70 bg-zinc-950 z-20 transition-[width] duration-200 ease-out overflow-hidden ${
          collapsed ? "w-0 border-r-0" : "w-48"
        }`}
      >
        {sidebarHeader}
        {sidebar}
        <SidebarFooter />
      </aside>

      {/* Main column */}
      <div className="flex-1 flex flex-col min-w-0">
        <AppHeader>
          <button
            onClick={() => setMobileOpen(true)}
            className="sm:hidden p-1 -ml-1 mr-1 text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            <List size={18} />
          </button>
          <Link
            to={linkTo}
            params={linkParams}
            className="sm:hidden flex items-center hover:opacity-80 transition-opacity shrink-0 mr-1.5"
          >
            <Logo className="size-5" />
          </Link>
          {header}
        </AppHeader>

        <main className="flex-1 overflow-y-auto overflow-x-hidden">
          {children}
        </main>
      </div>

      {/* Mobile backdrop */}
      <div
        className={`fixed inset-0 z-40 sm:hidden transition-opacity duration-200 ${
          mobileOpen ? "bg-black/50 opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={() => setMobileOpen(false)}
      />

      {/* Mobile drawer */}
      <div
        className={`fixed left-0 top-0 z-50 h-full w-64 flex flex-col border-r border-zinc-800 bg-zinc-950 sm:hidden transition-transform duration-200 ease-out ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="px-3.5 h-[52px] flex items-center justify-between border-b border-zinc-800/70">
          <div className="flex items-center gap-2.5 min-w-0">
            <Link
              to={linkTo}
              params={linkParams}
              className="flex items-center hover:opacity-80 transition-opacity shrink-0"
            >
              <Logo className="size-5" />
            </Link>
            <OrgSwitcher currentOrgId={orgId} currentOrgName={orgName} />
          </div>
          <button
            onClick={() => setMobileOpen(false)}
            className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/40 transition-colors"
          >
            <X size={16} />
          </button>
        </div>
        {sidebar}
        <SidebarFooter />
      </div>
    </div>
  );
}
