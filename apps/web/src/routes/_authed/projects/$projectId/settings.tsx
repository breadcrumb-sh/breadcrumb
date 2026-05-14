import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { AgentLimitsSection } from "../../../../components/settings/AgentLimitsSection";
import { AgentMemorySection } from "../../../../components/settings/AgentMemorySection";
import { AiProviderSection } from "../../../../components/settings/AiProviderSection";
import { ApiKeysSection } from "../../../../components/settings/ApiKeysSection";
import { DangerSection } from "../../../../components/settings/DangerSection";
import { GeneralSection } from "../../../../components/settings/GeneralSection";
import { NotificationsSection } from "../../../../components/settings/NotificationsSection";
import { GitHubSection } from "../../../../components/settings/GitHubSection";
import { ModelPricingSection } from "../../../../components/settings/ModelPricingSection";
import { PiiRedactionSection } from "../../../../components/settings/PiiRedactionSection";
import { useOrgRole } from "../../../../hooks/useOrgRole";
import { usePageView } from "../../../../hooks/usePageView";
import { trpc } from "../../../../lib/trpc";

const searchSchema = z.object({
  tab: z
    .enum([
      "general",
      "api-keys",
      "integrations",
      "model-pricing",
      "privacy",
      "ai",
      "memory",
      "limits",
      "danger",
    ])
    .optional(),
  // GitHub callback flags (consumed by GitHubSection):
  connected: z.string().optional(),
  error: z.string().optional(),
  info: z.string().optional(),
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

  const { tab, connected, error, info } = Route.useSearch();
  const defaultSection = isAdmin ? "general" : "api-keys";
  const section = tab ?? defaultSection;

  return (
    <div className="px-5 py-6 sm:px-6 sm:py-6 page-container-small">
      {section === "general" && (
        <GeneralSection projectId={projectId} canRename={isAdmin} />
      )}
      {section === "api-keys" && (
        <ApiKeysSection projectId={projectId} canManage={isAdmin} />
      )}
      {section === "integrations" && (
        <div className="space-y-10">
          <GitHubSection
            projectId={projectId}
            canManage={isAdmin}
            callback={{ connected, error, info }}
          />
          <NotificationsSection projectId={projectId} />
        </div>
      )}
      {section === "model-pricing" && (
        <ModelPricingSection projectId={projectId} canManage={isAdmin} />
      )}
      {section === "privacy" && <PiiRedactionSection projectId={projectId} />}
      {section === "ai" && <AiProviderSection projectId={projectId} />}
      {section === "memory" && <AgentMemorySection projectId={projectId} />}
      {section === "limits" && <AgentLimitsSection projectId={projectId} />}
      {section === "danger" && (
        <DangerSection projectId={projectId} canDelete={isOwner} />
      )}
    </div>
  );
}
