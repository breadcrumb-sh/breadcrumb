import { useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { CaretUpDown } from "@phosphor-icons/react/CaretUpDown";
import { Folder } from "@phosphor-icons/react/Folder";
import { Plus } from "@phosphor-icons/react/Plus";
import { Check } from "@phosphor-icons/react/Check";
import { trpc } from "../../lib/trpc";
import { useOrgRole } from "../../hooks/useOrgRole";
import { useClickOutside } from "../../hooks/useClickOutside";

export function ProjectSwitcher({
  orgId,
  currentProjectId,
  currentProjectName,
}: {
  orgId: string;
  currentProjectId?: string;
  currentProjectName?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { isAdmin } = useOrgRole(orgId);

  const projects = trpc.projects.list.useQuery(
    { organizationId: orgId },
    { enabled: open },
  );

  useClickOutside(ref, () => setOpen(false));

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-sm font-medium text-zinc-400 hover:text-zinc-200 transition-colors rounded-md px-1.5 py-1 -mx-1.5"
      >
        <span className="truncate max-w-[120px] sm:max-w-[180px]">
          {currentProjectName ?? "Select project"}
        </span>
        <CaretUpDown size={12} className="shrink-0 text-zinc-600" />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 w-56 rounded-lg border border-zinc-800 bg-zinc-900 shadow-xl py-1">
          {projects.data?.map((project) => (
            <button
              key={project.id}
              onClick={() => {
                navigate({
                  to: "/projects/$projectId",
                  params: { projectId: project.id },
                });
                setOpen(false);
              }}
              className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-left text-zinc-400 hover:text-zinc-100 transition-colors"
            >
              <Folder size={14} className="shrink-0 text-zinc-500" />
              <span className="truncate flex-1">
                {project.name}
              </span>
              {project.id === currentProjectId && (
                <Check size={14} className="shrink-0 text-zinc-400" />
              )}
            </button>
          ))}

          {isAdmin && (
            <>
              <div className="border-t border-zinc-800 my-1" />
              <Link
                to="/org/$orgId/new"
                params={{ orgId }}
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-zinc-400 hover:text-zinc-100 transition-colors"
              >
                <Plus size={14} className="shrink-0" />
                New project
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  );
}
