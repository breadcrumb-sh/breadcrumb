import { SquaresFourIcon } from "@phosphor-icons/react/SquaresFour";
import { Table } from "@phosphor-icons/react/Table";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import { z } from "zod";
import { useRegisterSubMenu } from "../../../../components/layout/SubMenuContext";
import { InsightsSection } from "../../../../components/traces/InsightsSection";
import { McpCallout } from "../../../../components/traces/McpCallout";
import { RawTracesSection } from "../../../../components/traces/RawTracesSection";
import { usePageView } from "../../../../hooks/usePageView";

type Section = "overview" | "raw";

const searchSchema = z.object({
  tab: z.enum(["overview", "raw"]).optional(),
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

const SIDEBAR_ITEMS: { id: Section; label: string; icon: React.ReactNode }[] = [
  { id: "overview", label: "Overview", icon: <SquaresFourIcon size={16} /> },
  { id: "raw", label: "Raw Traces", icon: <Table size={16} /> },
];

function TracesPage() {
  usePageView("traces");
  const navigate = Route.useNavigate();
  const { tab } = Route.useSearch();
  const section: Section = tab ?? "overview";

  const setSection = useCallback(
    (next: string) => {
      navigate({
        search: { tab: next as Section },
        replace: true,
      });
    },
    [navigate],
  );

  const subMenuItems = useMemo(
    () => SIDEBAR_ITEMS.map(({ id, label, icon }) => ({ id, label, icon })),
    [],
  );

  useRegisterSubMenu(subMenuItems, section, setSection);

  return (
    <main className="px-5 py-6 sm:px-8 sm:py-8 page-container-small">
      <div className="flex gap-8">
        <nav className="hidden sm:block w-44 shrink-0 space-y-0.5 sticky top-32 self-start">
          {SIDEBAR_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => setSection(item.id)}
              className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
                section === item.id
                  ? "bg-zinc-800 text-zinc-100 font-medium"
                  : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
              }`}
            >
              {item.icon}
              <span className="flex-1 text-left">{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="flex-1 min-w-0">
          <McpCallout />
          {section === "overview" && <InsightsSection />}
          {section === "raw" && <RawTracesSection />}
        </div>
      </div>
    </main>
  );
}
