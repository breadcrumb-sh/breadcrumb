import { createFileRoute, Link } from "@tanstack/react-router";
import { Plus } from "@phosphor-icons/react/Plus";
import { Folder } from "@phosphor-icons/react/Folder";
import { trpc } from "../../lib/trpc";
import { AppHeader } from "../../components/layout/AppHeader";
import { useAuth } from "../../hooks/useAuth";

export const Route = createFileRoute("/_authed/")({
  component: IndexPage,
});

function IndexPage() {
  const projects = trpc.projects.list.useQuery();
  const { isAdmin } = useAuth();

  if (projects.isLoading) return null;

  return (
    <>
    <AppHeader />
    <main className="page-container-small px-4 py-5 sm:px-8 sm:py-7 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Projects</h2>
        {isAdmin && (
          <Link
            to="/new"
            className="flex items-center gap-1.5 rounded-md px-3.5 py-2 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
          >
            <Plus size={15} />
            New project
          </Link>
        )}
      </div>

      {projects.data?.length ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.data.map((project) => (
            <Link
              key={project.id}
              to="/projects/$projectId"
              params={{ projectId: project.id }}
              className="rounded-lg border border-zinc-800 bg-zinc-900 px-5 py-5 space-y-3 hover:border-zinc-600 transition-colors"
            >
              <div className="flex items-center gap-3">
                <Folder size={18} className="text-zinc-500" />
                <span className="text-sm font-medium">{project.name}</span>
              </div>
              <p className="text-xs text-zinc-500">
                Created {new Date(project.createdAt).toLocaleDateString()}
              </p>
            </Link>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-700 py-20 text-center">
          <Folder size={28} className="text-zinc-600 mb-3" />
          <p className="text-sm text-zinc-400">No projects yet</p>
          {isAdmin && (
            <Link
              to="/new"
              className="mt-3 text-sm text-zinc-300 underline underline-offset-4 hover:text-zinc-100 transition-colors"
            >
              Create your first project
            </Link>
          )}
        </div>
      )}
    </main>
    </>
  );
}
