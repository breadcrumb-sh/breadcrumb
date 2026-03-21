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
import { SubMenuProvider } from "../../../components/layout/SubMenuContext";
import { UserMenu } from "../../../components/layout/UserMenu";
import { ErrorBoundary } from "../../../components/common/ErrorBoundary";
import { useAuth } from "../../../hooks/useAuth";
import { trpc } from "../../../lib/trpc";

export const Route = createFileRoute("/_authed/projects/$projectId")({
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

  const getActiveLabel = useCallback(() => {
    for (const { label, path, exact } of tabs) {
      const href = `/projects/${projectId}${path}`;
      const isActive = exact
        ? pathname === href
        : pathname.startsWith(href) ||
          (label === "Traces" &&
            pathname.startsWith(`/projects/${projectId}/trace/`));
      if (isActive) return label;
    }
    return null;
  }, [tabs, projectId, pathname]);

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

    // Enable transition only after first measurement
    requestAnimationFrame(() => setHasInitialized(true));
  }, [getActiveLabel]);

  return (
    <nav
      ref={navRef}
      className="relative pt-1 flex items-end gap-1 -mb-px max-w-[1500px] px-4 sm:px-8 mx-auto"
    >
      {tabs.map(({ label, path, exact }) => {
        const href = `/projects/${projectId}${path}`;
        const isActive = exact
          ? pathname === href
          : pathname.startsWith(href) ||
            (label === "Traces" &&
              pathname.startsWith(`/projects/${projectId}/trace/`));

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

      {/* Animated underline indicator */}
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
  const project = trpc.projects.get.useQuery({ id: projectId });
  const { isViewer } = useAuth();

  const visibleTabs = isViewer
    ? TABS.filter((t) => t.label !== "Settings")
    : TABS;

  return (
    <SubMenuProvider>
      <div>
        <div className="sticky top-0 z-20 bg-zinc-950">
          <header className="px-5 sm:px-8 border-b border-zinc-800/70 sm:border-b-0">
            {/* Nav row */}
            <div className="flex items-center justify-between h-14">
              <div className="flex items-center text-sm min-w-0">
                <Link
                  to="/"
                  className="flex items-center hover:opacity-80 transition-opacity shrink-0"
                >
                  <Logo className="size-5" />
                </Link>
                <span className="text-zinc-700 select-none shrink-0 mx-1.5">
                  /
                </span>
                <span className="font-medium text-zinc-400 truncate max-w-[100px] sm:max-w-none">
                  {project.data?.name ?? "…"}
                </span>
                {/* Mobile tab nav — inline after project name */}
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

          {/* Tab row — hidden on mobile */}
          <div className="border-b border-zinc-800/70 hidden sm:block">
            <AnimatedTabs
              tabs={visibleTabs}
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
