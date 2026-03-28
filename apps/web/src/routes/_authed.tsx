import { createFileRoute, Navigate, Outlet } from "@tanstack/react-router";
import { authClient } from "../lib/auth-client";
import { useAuth } from "../hooks/useAuth";

export const Route = createFileRoute("/_authed")({
  component: AuthedLayout,
});

function AuthedLayout() {
  const { data: session, isPending } = authClient.useSession();
  const { isDemo } = useAuth();

  if (isPending) return null;

  if (!session) {
    return <Navigate to="/login" />;
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {isDemo && (
        <div className="demo-banner border-b px-4 py-3.5 text-center text-sm text-pretty leading-relaxed">
          You're viewing the Breadcrumb demo.{" "}
          <a
            href="https://tally.so/r/A7xjRB"
            target="_blank"
            rel="noopener noreferrer"
            className="demo-banner-link underline underline-offset-2 font-medium transition-colors"
          >
            Get early access
          </a>
        </div>
      )}
      <Outlet />
    </div>
  );
}
