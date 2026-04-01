import { createFileRoute, Navigate } from "@tanstack/react-router";
import { trpc } from "../../../../lib/trpc";

export const Route = createFileRoute("/_authed/org/$orgId/")({
  component: OrgIndexPage,
});

function OrgIndexPage() {
  const { orgId } = Route.useParams();
  const projects = trpc.projects.list.useQuery({ organizationId: orgId });

  if (projects.isLoading) return null;

  // Redirect to first project, or to create one if none exist
  if (projects.data?.length) {
    return (
      <Navigate
        to="/projects/$projectId"
        params={{ projectId: projects.data[0].id }}
      />
    );
  }

  return <Navigate to="/org/$orgId/new" params={{ orgId }} />;
}
