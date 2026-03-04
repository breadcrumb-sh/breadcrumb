import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { authClient } from "../lib/auth-client";
import { trpc } from "../lib/trpc";

export const Route = createFileRoute("/_authed")({
  component: AuthedLayout,
});

function AuthedLayout() {
  const { data: session, isPending } = authClient.useSession();
  const { data: config, isLoading: configLoading } =
    trpc.config.publicViewing.useQuery();
  const navigate = useNavigate();

  if (isPending || configLoading) return null;

  if (!session && !config?.enabled) {
    navigate({ to: "/login" });
    return null;
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {config?.isDemo && (
        <div className="border-b px-4 py-3.5 text-center text-sm text-pretty leading-relaxed" style={{ background: "rgba(98,75,180,0.2)", borderColor: "rgba(98,75,180,0.4)", color: "rgba(185,170,235,1)" }}>
          You're viewing the Breadcrumb demo.{" "}
          <a
            href="https://breadcrumb.sh/early-access"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 font-medium hover:text-white transition-colors"
            style={{ color: "rgba(210,198,255,1)" }}
          >
            Sign up for early access
          </a>
        </div>
      )}
      <Outlet />
    </div>
  );
}
