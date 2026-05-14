import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/org/$orgId")({
  component: OrgLayout,
});

function OrgLayout() {
  return <Outlet />;
}
