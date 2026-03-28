import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { CostSection } from "../../../../components/traces/CostSection";
import { LatencySection } from "../../../../components/traces/LatencySection";
import { McpCallout } from "../../../../components/traces/McpCallout";
import { RawTracesSection } from "../../../../components/traces/RawTracesSection";
import { ReliabilitySection } from "../../../../components/traces/ReliabilitySection";
import { usePageView } from "../../../../hooks/usePageView";

const searchSchema = z.object({
  tab: z.enum(["reliability", "raw", "cost", "latency"]).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  preset: z.union([z.literal(7), z.literal(30), z.literal(90)]).optional(),
  names: z.array(z.string()).optional(),
  models: z.array(z.string()).optional(),
  statuses: z.array(z.enum(["ok", "error"])).optional(),
  env: z.array(z.string()).optional(),
  q: z.string().optional(),
  steps: z.array(z.string()).optional(),
  sortBy: z
    .enum([
      "name",
      "status",
      "spanCount",
      "tokens",
      "cost",
      "duration",
      "startTime",
    ])
    .optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
});

export const Route = createFileRoute("/_authed/projects/$projectId/traces")({
  validateSearch: searchSchema,
  component: TracesPage,
});

function TracesPage() {
  usePageView("traces");
  const { tab } = Route.useSearch();
  const section = tab ?? "reliability";

  return (
    <div className="px-5 py-6 sm:px-8 sm:py-8 page-container-small">
      <McpCallout />
      {section === "reliability" && <ReliabilitySection />}
      {section === "raw" && <RawTracesSection />}
      {section === "cost" && <CostSection />}
      {section === "latency" && <LatencySection />}
    </div>
  );
}
