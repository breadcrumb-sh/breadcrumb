import { createFileRoute, Navigate } from "@tanstack/react-router";
import { trpc } from "../../lib/trpc";

export const Route = createFileRoute("/_authed/")({
  component: IndexPage,
});

function IndexPage() {
  const orgs = trpc.organizations.list.useQuery();

  if (orgs.isLoading) return null;

  // Redirect to first org, or to create one if none exist
  if (orgs.data?.length) {
    return <Navigate to="/org/$orgId" params={{ orgId: orgs.data[0].id }} />;
  }

  return <Navigate to="/new-org" />;
}
