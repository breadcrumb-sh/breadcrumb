import { createRootRoute, Outlet } from "@tanstack/react-router";
import { ErrorBoundary } from "../components/common/ErrorBoundary";

export const Route = createRootRoute({
  component: () => (
    <ErrorBoundary>
      <Outlet />
    </ErrorBoundary>
  ),
});
