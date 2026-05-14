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
        className="flex cursor-pointer items-center gap-1 text-[12px] font-medium text-zinc-200 hover:text-zinc-100 transition-colors rounded-md px-1.5 py-1 -mx-1.5"
      >
        <span className="truncate max-w-[120px] sm:max-w-[180px]">
          {currentProjectName ?? "Select project"}
        </span>
        <CaretUpDown size={12} className="shrink-0 text-zinc-600" />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-[100] w-56 rounded-lg border border-zinc-800/70 bg-zinc-950 shadow-xl p-1">
          {projects.data?.map((project) => {
            const isCurrent = project.id === currentProjectId;
            return (
              <button
                key={project.id}
                onClick={() => {
                  navigate({
                    to: "/projects/$projectId",
                    params: { projectId: project.id },
                  });
                  setOpen(false);
                }}
                className={`flex cursor-pointer items-center gap-2 w-full rounded-md px-2.5 py-1.5 text-[12px] text-left transition-colors ${
                  isCurrent
                    ? "text-zinc-100 font-medium"
                    : "text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800/40"
                }`}
              >
                <Folder size={13} className="shrink-0 text-zinc-500" />
                <span className="truncate flex-1">{project.name}</span>
                {isCurrent && <Check size={13} className="shrink-0 text-zinc-400" />}
              </button>
            );
          })}

          {isAdmin && (
            <>
              <div className="-mx-1 my-1 border-t border-zinc-800/70" />
              <Link
                to="/org/$orgId/new"
                params={{ orgId }}
                onClick={() => setOpen(false)}
                className="flex cursor-pointer items-center gap-2 w-full rounded-md px-2.5 py-1.5 text-[12px] text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800/40 transition-colors"
              >
                <Plus size={13} className="shrink-0 text-zinc-500" />
                New project
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  );
}
