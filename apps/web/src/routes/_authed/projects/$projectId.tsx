import {
  createFileRoute,
  Link,
  Outlet,
  useRouterState,
} from "@tanstack/react-router";
import { Logo } from "../../../components/common/logo/Logo";
import { UserMenu } from "../../../components/UserMenu";
import { MobileNav } from "../../../components/MobileNav";
import { SubMenuProvider } from "../../../components/SubMenuContext";
import { trpc } from "../../../lib/trpc";
import { useAuth } from "../../../hooks/useAuth";

export const Route = createFileRoute("/_authed/projects/$projectId")({
  component: ProjectLayout,
});

const TABS = [
  { label: "Overview", path: "", exact: true },
  { label: "Traces", path: "/traces", exact: false },
  { label: "Explore", path: "/explore", exact: false },
  { label: "Settings", path: "/settings", exact: false },
] as const;

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
          <header className="px-5 sm:px-8">
            {/* Nav row */}
            <div className="flex items-center justify-between h-14">
              <div className="flex items-center gap-2 text-sm">
                <Link
                  to="/"
                  className="flex items-center hover:opacity-80 transition-opacity"
                >
                  <Logo className="size-5" />
                </Link>
                <span className="text-zinc-700 select-none">/</span>
                <span className="font-medium text-zinc-400">
                  {project.data?.name ?? "…"}
                </span>
              </div>

              <UserMenu />
            </div>
          </header>

          {/* Tab row — hidden on mobile */}
          <nav className="border-b border-zinc-800/70 pt-1 hidden sm:flex items-end gap-1 -mb-px max-w-[1250px] px-4 sm:px-8 mx-auto">
          {visibleTabs.map(({ label, path, exact }) => {
            const href = `/projects/${projectId}${path}`;
            const isActive = exact
              ? pathname === href
              : pathname.startsWith(href);

            return (
              <Link
                key={label}
                to={`/projects/$projectId${path}`}
                params={{ projectId }}
                className={`px-3 py-2.5 text-sm font-medium transition-colors border-b-2 ${
                  isActive
                    ? "border-zinc-100 text-zinc-100"
                    : "border-transparent text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {label}
              </Link>
            );
          })}
          </nav>

          {/* Mobile breadcrumb nav */}
          <MobileNav projectId={projectId} />
        </div>

        <div className="page-container">
          <Outlet />
        </div>
      </div>
    </SubMenuProvider>
  );
}
