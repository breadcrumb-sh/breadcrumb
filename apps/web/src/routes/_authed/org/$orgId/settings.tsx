import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import { z } from "zod";
import { Users } from "@phosphor-icons/react/Users";
import { Warning } from "@phosphor-icons/react/Warning";
import { MembersSection } from "../../../../components/settings/MembersSection";
import { useRegisterSubMenu } from "../../../../components/layout/SubMenuContext";
import { useOrgRole } from "../../../../hooks/useOrgRole";
import { usePageView } from "../../../../hooks/usePageView";
import { AppHeader } from "../../../../components/layout/AppHeader";
import { SubMenuProvider } from "../../../../components/layout/SubMenuContext";
import { trpc } from "../../../../lib/trpc";

type Section = "members" | "danger";

const searchSchema = z.object({
  tab: z.enum(["members", "danger"]).optional(),
});

export const Route = createFileRoute("/_authed/org/$orgId/settings")({
  validateSearch: searchSchema,
  component: OrgSettingsPage,
});

function OrgSettingsPage() {
  usePageView("org-settings");
  const { orgId } = Route.useParams();
  const { isAdmin, isOwner } = useOrgRole(orgId);
  const org = trpc.organizations.get.useQuery({ id: orgId });

  const visibleSections: {
    id: Section;
    label: string;
    icon: React.ReactNode;
  }[] = [
    { id: "members" as Section, label: "Members", icon: <Users size={16} /> },
    ...(isOwner
      ? [
          {
            id: "danger" as Section,
            label: "Danger",
            icon: <Warning size={16} />,
          },
        ]
      : []),
  ];

  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  const section: Section =
    tab && visibleSections.some((s) => s.id === tab) ? tab : "members";

  const setSection = useCallback(
    (next: string) => {
      navigate({ search: { tab: next as Section }, replace: true });
    },
    [navigate],
  );

  const subMenuItems = useMemo(
    () => visibleSections.map(({ id, label, icon }) => ({ id, label, icon })),
    [visibleSections],
  );

  useRegisterSubMenu(subMenuItems, section, setSection);

  const deleteOrg = trpc.organizations.delete.useMutation({
    onSuccess: () => navigate({ to: "/" }),
  });

  return (
    <SubMenuProvider>
      <AppHeader />
      <main className="page-container-small px-5 py-6 sm:px-8 sm:py-8">
        <h2 className="text-lg font-semibold mb-6">
          {org.data?.name ?? "…"} — Settings
        </h2>
        <div className="flex gap-8">
          <nav className="hidden sm:block w-44 shrink-0 space-y-0.5 sticky top-32 self-start">
            {visibleSections.map((item) => (
              <button
                key={item.id}
                onClick={() => setSection(item.id)}
                className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
                  section === item.id
                    ? "bg-zinc-800 text-zinc-100 font-medium"
                    : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                }`}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </nav>

          <div className="flex-1 min-w-0">
            {section === "members" && (
              <MembersSection
                organizationId={orgId}
                canManage={isAdmin}
                myOrgRole={undefined}
              />
            )}
            {section === "danger" && isOwner && (
              <div className="space-y-4">
                <h3 className="text-base font-medium text-red-400">
                  Delete organization
                </h3>
                <p className="text-sm text-zinc-400">
                  This will permanently delete the organization, all its
                  projects, and all associated data. This action cannot be
                  undone.
                </p>
                <button
                  onClick={() => {
                    if (
                      window.confirm(
                        "Are you sure you want to delete this organization? This cannot be undone.",
                      )
                    ) {
                      deleteOrg.mutate({ organizationId: orgId });
                    }
                  }}
                  disabled={deleteOrg.isPending}
                  className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors disabled:opacity-50"
                >
                  {deleteOrg.isPending
                    ? "Deleting…"
                    : "Delete organization"}
                </button>
              </div>
            )}
          </div>
        </div>
      </main>
    </SubMenuProvider>
  );
}
