import { useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { CaretUpDown } from "@phosphor-icons/react/CaretUpDown";
import { Buildings } from "@phosphor-icons/react/Buildings";
import { Gear } from "@phosphor-icons/react/Gear";
import { Plus } from "@phosphor-icons/react/Plus";
import { Check } from "@phosphor-icons/react/Check";
import { trpc } from "../../lib/trpc";
import { useAuth } from "../../hooks/useAuth";
import { useClickOutside } from "../../hooks/useClickOutside";

export function OrgSwitcher({
  currentOrgId,
  currentOrgName,
}: {
  currentOrgId?: string;
  currentOrgName?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { allowOrgCreation } = useAuth();

  const orgs = trpc.organizations.list.useQuery(undefined, {
    enabled: open,
  });

  useClickOutside(ref, () => setOpen(false));

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-200 transition-colors rounded-md px-1.5 py-1 -mx-1.5"
      >
        <span className="truncate max-w-[120px] sm:max-w-[180px]">
          {currentOrgName ?? "Select org"}
        </span>
        <CaretUpDown size={12} className="shrink-0 text-zinc-600" />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 w-56 rounded-lg border border-zinc-800 bg-zinc-900 shadow-xl py-1">
          {orgs.data?.map((org) => (
            <button
              key={org.id}
              onClick={() => {
                navigate({ to: "/org/$orgId", params: { orgId: org.id } });
                setOpen(false);
              }}
              className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-left text-zinc-400 hover:text-zinc-100 transition-colors"
            >
              <Buildings size={14} className="shrink-0 text-zinc-500" />
              <span className="truncate flex-1">
                {org.name}
              </span>
              {org.id === currentOrgId && (
                <Check size={14} className="shrink-0 text-zinc-400" />
              )}
            </button>
          ))}

          <div className="border-t border-zinc-800 my-1" />
          {currentOrgId && (
            <Link
              to="/org/$orgId/settings"
              params={{ orgId: currentOrgId }}
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-zinc-400 hover:text-zinc-100 transition-colors"
            >
              <Gear size={14} className="shrink-0" />
              Organization settings
            </Link>
          )}
          {allowOrgCreation && (
            <Link
              to="/new-org"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-zinc-400 hover:text-zinc-100 transition-colors"
            >
              <Plus size={14} className="shrink-0" />
              New organization
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
