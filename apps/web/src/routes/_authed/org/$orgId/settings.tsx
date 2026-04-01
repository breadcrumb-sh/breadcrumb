import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Gear } from "@phosphor-icons/react/Gear";
import { Users } from "@phosphor-icons/react/Users";
import { Warning } from "@phosphor-icons/react/Warning";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { PageShell } from "../../../../components/layout/PageShell";
import { ProjectSwitcher } from "../../../../components/layout/ProjectSwitcher";
import { SidebarNav, type NavEntry } from "../../../../components/layout/SidebarNav";
import { MembersSection } from "../../../../components/settings/MembersSection";
import { backdropCls, popupCls } from "../../../../components/settings/dialog-styles";
import { useOrgRole } from "../../../../hooks/useOrgRole";
import { usePageView } from "../../../../hooks/usePageView";
import { trpc } from "../../../../lib/trpc";

type Section = "general" | "members" | "danger";

const searchSchema = z.object({
  tab: z.enum(["general", "members", "danger"]).optional(),
});

export const Route = createFileRoute("/_authed/org/$orgId/settings")({
  validateSearch: searchSchema,
  component: OrgSettingsPage,
});

// ── Org General Section ─────────────────────────────────────────────────────

function OrgGeneralSection({ orgId, canEdit }: { orgId: string; canEdit: boolean }) {
  const utils = trpc.useUtils();
  const org = trpc.organizations.get.useQuery({ id: orgId });
  const update = trpc.organizations.update.useMutation({
    onSuccess: () => {
      utils.organizations.get.invalidate({ id: orgId });
      utils.organizations.list.invalidate();
    },
  });

  const [name, setName] = useState(org.data?.name ?? "");

  useEffect(() => {
    if (org.data?.name !== undefined) setName(org.data.name);
  }, [org.data?.name]);

  const isDirty = name !== org.data?.name;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isDirty) update.mutate({ organizationId: orgId, name });
  };

  return (
    <section className="space-y-6 max-w-md">
      <h3 className="text-sm font-semibold mb-4">General</h3>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-1.5">
            Organization name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            disabled={!canEdit}
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-zinc-500 disabled:opacity-50"
          />
        </div>
        <button
          type="submit"
          disabled={!canEdit || update.isPending || !isDirty}
          className="rounded-md bg-zinc-100 px-4 py-1.5 text-sm font-medium text-zinc-900 hover:bg-zinc-200 transition-colors disabled:opacity-50"
        >
          Save
        </button>
      </form>
    </section>
  );
}

// ── Org Danger Section ──────────────────────────────────────────────────────

function OrgDangerSection({ orgId }: { orgId: string }) {
  const navigate = Route.useNavigate();
  const deleteOrg = trpc.organizations.delete.useMutation({
    onSuccess: () => navigate({ to: "/" }),
  });

  return (
    <section className="space-y-4">
      <h3 className="text-sm font-semibold">Danger Zone</h3>
      <div className="rounded-md border border-red-900/50 p-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-zinc-100">Delete this organization</p>
          <p className="text-xs text-zinc-400 mt-0.5">
            Permanently deletes all projects, traces, and API keys. This cannot be undone.
          </p>
        </div>
        <AlertDialog.Root>
          <AlertDialog.Trigger className="shrink-0 rounded-md border border-red-800 px-3 py-1.5 text-sm font-medium text-red-400 hover:bg-red-950 transition-colors">
            Delete organization
          </AlertDialog.Trigger>
          <AlertDialog.Portal>
            <AlertDialog.Backdrop className={backdropCls} />
            <AlertDialog.Viewport className="fixed inset-0 z-50 grid place-items-center px-4">
              <AlertDialog.Popup className={popupCls}>
                <AlertDialog.Title className="text-base font-semibold text-zinc-100 mb-1">
                  Delete organization?
                </AlertDialog.Title>
                <AlertDialog.Description className="text-sm text-zinc-400 mb-6">
                  All projects, traces, and API keys will be permanently deleted. This action cannot be undone.
                </AlertDialog.Description>
                <div className="flex justify-end gap-2">
                  <AlertDialog.Close className="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 transition-colors">
                    Cancel
                  </AlertDialog.Close>
                  <AlertDialog.Close
                    onClick={() => deleteOrg.mutate({ organizationId: orgId })}
                    disabled={deleteOrg.isPending}
                    className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 transition-colors disabled:opacity-50"
                  >
                    Delete organization
                  </AlertDialog.Close>
                </div>
              </AlertDialog.Popup>
            </AlertDialog.Viewport>
          </AlertDialog.Portal>
        </AlertDialog.Root>
      </div>
    </section>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

function OrgSettingsPage() {
  usePageView("org-settings");
  const { orgId } = Route.useParams();
  const { isAdmin, isOwner } = useOrgRole(orgId);
  const org = trpc.organizations.get.useQuery({ id: orgId });
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();

  const navItems: NavEntry[] = useMemo(() => [
    ...(isAdmin ? [{ kind: "leaf" as const, label: "General", icon: Gear, id: "general" }] : []),
    { kind: "leaf" as const, label: "Members", icon: Users, id: "members" },
    ...(isOwner ? [{ kind: "leaf" as const, label: "Danger", icon: Warning, id: "danger" }] : []),
  ], [isAdmin, isOwner]);

  const defaultSection: Section = isAdmin ? "general" : "members";
  const section: Section =
    tab && navItems.some((s) => s.kind === "leaf" && s.id === tab) ? tab : defaultSection;

  const handleSelect = useCallback(
    (id: string) => navigate({ search: { tab: id as Section }, replace: true }),
    [navigate],
  );

  return (
    <PageShell
      orgId={orgId}
      orgName={org.data?.name}
      sidebar={
        <SidebarNav
          items={navItems}
          activeId={section}
          onSelect={handleSelect}
        />
      }
      header={
        <ProjectSwitcher orgId={orgId} currentProjectName="Select project" />
      }
    >
      <div className="px-5 py-6 sm:px-8 sm:py-8 page-container-small">
        {section === "general" && <OrgGeneralSection orgId={orgId} canEdit={isAdmin} />}
        {section === "members" && (
          <MembersSection organizationId={orgId} canManage={isAdmin} myOrgRole={undefined} />
        )}
        {section === "danger" && isOwner && <OrgDangerSection orgId={orgId} />}
      </div>
    </PageShell>
  );
}
