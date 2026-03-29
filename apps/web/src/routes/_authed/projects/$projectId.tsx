import {
  createFileRoute,
  Outlet,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { ChartBar } from "@phosphor-icons/react/ChartBar";
import { Gear } from "@phosphor-icons/react/Gear";
import { SquaresFour } from "@phosphor-icons/react/SquaresFour";
import { useCallback, useMemo } from "react";
import { ErrorBoundary } from "../../../components/common/ErrorBoundary";
import { PageShell } from "../../../components/layout/PageShell";
import { ProjectSwitcher } from "../../../components/layout/ProjectSwitcher";
import { SidebarNav, type NavEntry } from "../../../components/layout/SidebarNav";
import { useOrgRole } from "../../../hooks/useOrgRole";
import { trpc } from "../../../lib/trpc";

export const Route = createFileRoute(
  "/_authed/projects/$projectId",
)({
  component: ProjectLayout,
});

// ── Nav helpers ─────────────────────────────────────────────────────────────

function buildNavItems(isAdmin: boolean, isOwner: boolean): NavEntry[] {
  return [
    {
      kind: "leaf",
      label: "Overview",
      icon: SquaresFour,
      id: "overview",
    },
    {
      kind: "group",
      label: "Traces",
      icon: ChartBar,
      children: [
        { label: "Reliability", id: "traces:reliability" },
        { label: "Performance", id: "traces:performance" },
        { label: "Raw Traces", id: "traces:raw" },
      ],
    },
    {
      kind: "group",
      label: "Settings",
      icon: Gear,
      children: [
        ...(isAdmin ? [{ label: "General", id: "settings:general" }] : []),
        { label: "API Keys", id: "settings:api-keys" },
        ...(isAdmin ? [{ label: "AI Provider", id: "settings:ai" }] : []),
        { label: "Agent Memory", id: "settings:memory" },
        ...(isOwner ? [{ label: "Danger", id: "settings:danger" }] : []),
      ],
    },
  ];
}

/** Map nav item id → route navigation params. */
function navIdToRoute(projectId: string) {
  return (id: string) => {
    const routes: Record<string, { to: string; search?: Record<string, string> }> = {
      "overview": { to: "/projects/$projectId" },
      "traces:reliability": { to: "/projects/$projectId/traces", search: { tab: "reliability" } },
      "traces:performance": { to: "/projects/$projectId/traces", search: { tab: "performance" } },
      "traces:raw": { to: "/projects/$projectId/traces", search: { tab: "raw" } },
      "settings:general": { to: "/projects/$projectId/settings", search: { tab: "general" } },
      "settings:api-keys": { to: "/projects/$projectId/settings", search: { tab: "api-keys" } },
      "settings:ai": { to: "/projects/$projectId/settings", search: { tab: "ai" } },
      "settings:memory": { to: "/projects/$projectId/settings", search: { tab: "memory" } },
      "settings:danger": { to: "/projects/$projectId/settings", search: { tab: "danger" } },
    };
    return routes[id] ?? { to: "/projects/$projectId" };
  };
}

/** Determine active nav id from current URL. */
function getActiveId(pathname: string, base: string, tab?: string): string {
  const rel = pathname.slice(base.length) || "";
  if (rel.startsWith("/settings")) {
    return `settings:${tab ?? "general"}`;
  }
  if (rel.startsWith("/traces") || rel.startsWith("/trace/")) {
    return `traces:${tab ?? "reliability"}`;
  }
  return "overview";
}

/** Which groups should start expanded based on current URL. */
function getDefaultOpen(pathname: string, base: string): string[] {
  const rel = pathname.slice(base.length) || "";
  const open: string[] = [];
  if (rel.startsWith("/traces") || rel.startsWith("/trace/")) open.push("Traces");
  if (rel.startsWith("/settings")) open.push("Settings");
  return open;
}

// ── Component ───────────────────────────────────────────────────────────────

function ProjectLayout() {
  const { projectId } = Route.useParams();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const search = useRouterState({ select: (s) => s.location.search as Record<string, unknown> });
  const navigate = useNavigate();

  const project = trpc.projects.get.useQuery({ projectId }, { placeholderData: (prev) => prev });
  const orgId = project.data?.organizationId;
  const org = trpc.organizations.get.useQuery(
    { id: orgId! },
    { enabled: !!orgId, placeholderData: (prev) => prev },
  );
  const { isAdmin, isOwner } = useOrgRole(orgId ?? "");

  const base = `/projects/${projectId}`;
  const tab = typeof search.tab === "string" ? search.tab : undefined;
  const activeId = getActiveId(pathname, base, tab);
  const navItems = useMemo(() => buildNavItems(isAdmin, isOwner), [isAdmin, isOwner]);
  const defaultOpen = useMemo(() => getDefaultOpen(pathname, base), [pathname, base]);

  const resolver = useMemo(() => navIdToRoute(projectId), [projectId]);
  const handleSelect = useCallback(
    (id: string) => {
      const r = resolver(id);
      navigate({ to: r.to as any, params: { projectId }, search: r.search ?? {} } as any);
    },
    [navigate, projectId, resolver],
  );

  return (
    <PageShell
      orgId={orgId}
      orgName={org.data?.name}
      sidebar={
        <SidebarNav
          items={navItems}
          activeId={activeId}
          onSelect={handleSelect}
          defaultOpen={defaultOpen}
        />
      }
      header={
        <ProjectSwitcher
          orgId={orgId ?? ""}
          currentProjectId={projectId}
          currentProjectName={project.data?.name}
        />
      }
    >
      <ErrorBoundary>
        <Outlet />
      </ErrorBoundary>
    </PageShell>
  );
}
