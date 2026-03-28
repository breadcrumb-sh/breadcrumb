import {
  createFileRoute,
  Link,
  Outlet,
  useRouterState,
} from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Logo } from "../../../components/common/logo/Logo";
import { FeedbackButton } from "../../../components/layout/FeedbackButton";
import { MobileNav } from "../../../components/layout/MobileNav";
import { OrgSwitcher } from "../../../components/layout/OrgSwitcher";
import { ProjectSwitcher } from "../../../components/layout/ProjectSwitcher";
import { SubMenuProvider } from "../../../components/layout/SubMenuContext";
import { UserMenu } from "../../../components/layout/UserMenu";
import { ErrorBoundary } from "../../../components/common/ErrorBoundary";
import { trpc } from "../../../lib/trpc";

export const Route = createFileRoute(
  "/_authed/projects/$projectId",
)({
  component: ProjectLayout,
});

const TABS = [
  { label: "Overview", path: "", exact: true },
  { label: "Traces", path: "/traces", exact: false },
  { label: "Explore", path: "/explore", exact: false },
  { label: "Settings", path: "/settings", exact: false },
] as const;

function AnimatedTabs({
  tabs,
  projectId,
  pathname,
}: {
  tabs: readonly (typeof TABS)[number][];
  projectId: string;
  pathname: string;
}) {
  const navRef = useRef<HTMLElement>(null);
  const tabRefs = useRef<Map<string, HTMLAnchorElement>>(new Map());
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });
  const [hasInitialized, setHasInitialized] = useState(false);

  const base = `/projects/${projectId}`;

  const getActiveLabel = useCallback(() => {
    for (const { label, path, exact } of tabs) {
      const href = `${base}${path}`;
      const isActive = exact
        ? pathname === href
        : pathname.startsWith(href) ||
          (label === "Traces" && pathname.startsWith(`${base}/trace/`));
      if (isActive) return label;
    }
    return null;
  }, [tabs, base, pathname]);

  useEffect(() => {
    const activeLabel = getActiveLabel();
    if (!activeLabel || !navRef.current) return;

    const tabEl = tabRefs.current.get(activeLabel);
    if (!tabEl) return;

    const navRect = navRef.current.getBoundingClientRect();
    const tabRect = tabEl.getBoundingClientRect();

    setIndicator({
      left: tabRect.left - navRect.left,
      width: tabRect.width,
    });

    requestAnimationFrame(() => setHasInitialized(true));
  }, [getActiveLabel]);

  return (
    <nav
      ref={navRef}
      className="relative pt-1 flex items-end gap-1 -mb-px max-w-[1500px] px-4 sm:px-8 mx-auto"
    >
      {tabs.map(({ label, path }) => {
        const href = `${base}${path}`;
        const isActive =
          path === ""
            ? pathname === href
            : pathname.startsWith(href) ||
              (label === "Traces" && pathname.startsWith(`${base}/trace/`));

        return (
          <Link
            key={label}
            ref={(el: HTMLAnchorElement | null) => {
              if (el) tabRefs.current.set(label, el);
              else tabRefs.current.delete(label);
            }}
            to={`/projects/$projectId${path}`}
            params={{ projectId }}
            className={`px-3 py-2.5 text-sm font-medium transition-colors border-b-2 border-transparent ${
              isActive ? "text-zinc-100" : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {label}
          </Link>
        );
      })}

      <div
        className="absolute bottom-0 h-[2px] bg-zinc-100"
        style={{
          left: indicator.left,
          width: indicator.width,
          transition: hasInitialized
            ? "left 0.15s cubic-bezier(0.4, 0, 0.2, 1), width 0.15s cubic-bezier(0.4, 0, 0.2, 1)"
            : "none",
        }}
      />
    </nav>
  );
}

function ProjectLayout() {
  const { projectId } = Route.useParams();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const project = trpc.projects.get.useQuery({ projectId });
  const orgId = project.data?.organizationId;
  const org = trpc.organizations.get.useQuery(
    { id: orgId! },
    { enabled: !!orgId },
  );

  return (
    <SubMenuProvider>
      <div>
        <div className="sticky top-0 z-20 bg-zinc-950">
          <header className="px-5 sm:px-8 border-b border-zinc-800/70 sm:border-b-0">
            <div className="flex items-center justify-between h-14">
              <div className="flex items-center text-sm min-w-0">
                <Link
                  to={orgId ? "/org/$orgId" : "/"}
                  params={orgId ? { orgId } : {}}
                  className="flex items-center hover:opacity-80 transition-opacity shrink-0"
                >
                  <Logo className="size-5" />
                </Link>
                <span className="text-zinc-700 select-none shrink-0 mx-1.5">
                  /
                </span>
                <OrgSwitcher
                  currentOrgId={orgId}
                  currentOrgName={org.data?.name}
                />
                <span className="text-zinc-700 select-none shrink-0 mx-1.5">
                  /
                </span>
                <ProjectSwitcher
                  orgId={orgId ?? ""}
                  currentProjectId={projectId}
                  currentProjectName={project.data?.name}
                />
                <div className="sm:hidden contents">
                  <MobileNav projectId={projectId} />
                </div>
              </div>

              <div className="flex items-center gap-4">
                <FeedbackButton />
                <UserMenu />
              </div>
            </div>
          </header>

          <div className="border-b border-zinc-800/70 hidden sm:block">
            <AnimatedTabs
              tabs={TABS}
              projectId={projectId}
              pathname={pathname}
            />
          </div>
        </div>
        <div className="page-container">
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </div>
      </div>
    </SubMenuProvider>
  );
}
