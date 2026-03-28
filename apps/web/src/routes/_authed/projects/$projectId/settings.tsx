import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { AiProviderSection } from "../../../../components/settings/AiProviderSection";
import { ApiKeysSection } from "../../../../components/settings/ApiKeysSection";
import { DangerSection } from "../../../../components/settings/DangerSection";
import { GeneralSection } from "../../../../components/settings/GeneralSection";
import { useOrgRole } from "../../../../hooks/useOrgRole";
import { usePageView } from "../../../../hooks/usePageView";
import { trpc } from "../../../../lib/trpc";

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

  const { tab } = Route.useSearch();
  const defaultSection = isAdmin ? "general" : "api-keys";
  const section = tab ?? defaultSection;

  return (
    <div className="px-5 py-6 sm:px-8 sm:py-8 page-container-small">
      {section === "general" && (
        <GeneralSection projectId={projectId} canRename={isAdmin} />
      )}
      {section === "api-keys" && (
        <ApiKeysSection projectId={projectId} canManage={isAdmin} />
      )}
      {section === "ai" && <AiProviderSection projectId={projectId} />}
      {section === "danger" && (
        <DangerSection projectId={projectId} canDelete={isOwner} />
      )}
    </div>
  );
}
