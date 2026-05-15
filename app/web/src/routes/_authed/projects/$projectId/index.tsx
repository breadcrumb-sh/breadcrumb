import { createFileRoute } from "@tanstack/react-router";
import { usePageView } from "../../../../hooks/usePageView";

export const Route = createFileRoute("/_authed/projects/$projectId/")({
  component: OverviewPage,
});

function OverviewPage() {
  usePageView("overview");
  return (
    <div className="px-5 py-6 sm:px-6 sm:py-6 page-container-small">
      <h1 className="text-base font-semibold mb-2">Overview</h1>
      <p className="text-zinc-400 text-sm">No features yet.</p>
    </div>
  );
}
