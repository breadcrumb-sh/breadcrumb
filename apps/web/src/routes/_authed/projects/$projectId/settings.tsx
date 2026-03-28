import { Brain } from "@phosphor-icons/react/Brain";
import { Gear } from "@phosphor-icons/react/Gear";
import { Key } from "@phosphor-icons/react/Key";
import { Warning } from "@phosphor-icons/react/Warning";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import { z } from "zod";
import { AiProviderSection } from "../../../../components/settings/AiProviderSection";
import { ApiKeysSection } from "../../../../components/settings/ApiKeysSection";
import { DangerSection } from "../../../../components/settings/DangerSection";
import { GeneralSection } from "../../../../components/settings/GeneralSection";
import { useRegisterSubMenu } from "../../../../components/layout/SubMenuContext";
import { useOrgRole } from "../../../../hooks/useOrgRole";
import { usePageView } from "../../../../hooks/usePageView";
import { trpc } from "../../../../lib/trpc";

type Section = "general" | "api-keys" | "ai" | "danger";

const searchSchema = z.object({
  tab: z.enum(["general", "api-keys", "ai", "danger"]).optional(),
});

export const Route = createFileRoute("/_authed/projects/$projectId/settings")({
  validateSearch: searchSchema,
  component: SettingsPage,
});

function SettingsPage() {
  usePageView("settings");
  const { projectId } = Route.useParams();
  const project = trpc.projects.get.useQuery({ projectId });
  const orgId = project.data?.organizationId ?? "";
  const { isAdmin, isOwner } = useOrgRole(orgId);

  const visibleSections: {
    id: Section;
    label: string;
    icon: React.ReactNode;
  }[] = [
    ...(isAdmin
      ? [
          {
            id: "general" as Section,
            label: "General",
            icon: <Gear size={16} />,
          },
        ]
      : []),
    { id: "api-keys" as Section, label: "API Keys", icon: <Key size={16} /> },
    ...(isAdmin
      ? [
          {
            id: "ai" as Section,
            label: "AI Provider",
            icon: <Brain size={16} />,
          },
        ]
      : []),
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
  const defaultSection: Section = isAdmin ? "general" : "api-keys";
  const section: Section =
    tab && visibleSections.some((s) => s.id === tab) ? tab : defaultSection;

  const setSection = useCallback(
    (next: string) => {
      navigate({
        search: { tab: next as Section },
        replace: true,
      });
    },
    [navigate],
  );

  const subMenuItems = useMemo(
    () => visibleSections.map(({ id, label, icon }) => ({ id, label, icon })),
    [visibleSections],
  );

  useRegisterSubMenu(subMenuItems, section, setSection);

  return (
    <main className="px-5 py-6 sm:px-8 sm:py-8 page-container-small">
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
          {section === "general" && (
            <GeneralSection
              projectId={projectId}
              canRename={isAdmin}
            />
          )}
          {section === "api-keys" && (
            <ApiKeysSection
              projectId={projectId}
              canManage={isAdmin}
            />
          )}
          {section === "ai" && <AiProviderSection projectId={projectId} />}
          {section === "danger" && (
            <DangerSection projectId={projectId} canDelete={isOwner} />
          )}
        </div>
      </div>
    </main>
  );
}
