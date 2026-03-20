import { DotsThree } from "@phosphor-icons/react/DotsThree";
import { Star } from "@phosphor-icons/react/Star";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useRef, useState } from "react";
import { useClickOutside } from "../../hooks/useClickOutside";
import { trpc } from "../../lib/trpc";
import { ChartSkeleton } from "../common/ChartSkeleton";
import { ExplorationChart, VIZ_COLORS } from "../traces/ExplorationChart";

type StarredChart = {
  id: string;
  title: string | null;
  chartType: string | null;
  sql: string | null;
  xKey: string | null;
  yKeys: unknown;
  legend: unknown;
  defaultDays: number | null;
  exploreId: string;
  exploreName: string;
};

type LegendEntry = { key: string; label: string; color: string };

/** Compute the number of whole days between two YYYY-MM-DD strings (inclusive). */
function daysBetween(from: string, to: string): number {
  const ms = new Date(to).getTime() - new Date(from).getTime();
  return Math.max(1, Math.round(ms / (1000 * 60 * 60 * 24)) + 1);
}

export function StarredChartCard({
  chart,
  projectId,
  from,
  to,
}: {
  chart: StarredChart;
  projectId: string;
  /** Dashboard "from" date (YYYY-MM-DD). */
  from: string;
  /** Dashboard "to" date (YYYY-MM-DD). */
  to: string;
}) {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // React Query deduplicates — the parent layout already fetches this
  const project = trpc.projects.get.useQuery({ id: projectId });
  const timezone = project.data?.timezone ?? undefined;

  const removeStar = trpc.explores.unstarChart.useMutation({
    onSettled: () => {
      utils.explores.listStarred.invalidate();
    },
  });

  // Use the dashboard's date range to compute the lookback window
  const days = daysBetween(from, to);

  // Re-run the query with the dashboard's day range
  const chartData = trpc.explores.requery.useQuery(
    { projectId, sql: chart.sql!, days },
    { enabled: !!chart.sql },
  );

  const closeMenu = useCallback(() => setMenuOpen(false), []);
  useClickOutside(menuRef, closeMenu);

  const legend = (chart.legend ?? []) as LegendEntry[];
  const yKeys = (chart.yKeys ?? []) as string[];

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-5 pt-4 pb-4">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <p className="min-w-0 flex-1 text-sm font-medium text-zinc-200 truncate">
          {chart.title ?? "Untitled chart"}
        </p>

        <div className="flex items-center gap-1 shrink-0 ml-2">
          {/* Context menu */}
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              aria-label="Open menu"
              className="p-1 rounded text-zinc-600 hover:text-zinc-300 hover:bg-zinc-700/50 transition-colors"
            >
              <DotsThree size={16} weight="bold" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 z-10 w-44 rounded-md border border-zinc-700 bg-zinc-800 py-1 shadow-lg">
                <button
                  onClick={() => {
                    removeStar.mutate({ id: chart.id });
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 transition-colors"
                >
                  <Star size={12} />
                  Remove star
                </button>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    navigate({
                      to: "/projects/$projectId/explore",
                      params: { projectId },
                      search: { id: chart.exploreId },
                    });
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 transition-colors"
                >
                  Go to exploration
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Legend */}
      {legend.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap mb-3">
          {legend.map((entry, i) => (
            <span
              key={entry.key}
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-[10px] text-zinc-400"
            >
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ backgroundColor: VIZ_COLORS[i % VIZ_COLORS.length] }}
              />
              {entry.label}
            </span>
          ))}
        </div>
      )}

      {/* Chart */}
      {chartData.isLoading ? (
        <ChartSkeleton variant={chart.chartType === "bar" ? "bar" : "area"} />
      ) : chartData.data && chartData.data.length > 0 && chart.chartType && chart.xKey && yKeys.length > 0 ? (
        <ExplorationChart
          chartType={chart.chartType as "bar" | "line"}
          xKey={chart.xKey}
          yKeys={yKeys}
          legend={legend.length > 0 ? legend : undefined}
          data={chartData.data}
          timezone={timezone}
          from={from}
          to={to}
        />
      ) : (
        <div className="flex items-center justify-center rounded-md border border-dashed border-zinc-700 bg-zinc-900/50 py-12">
          <p className="text-xs text-zinc-500">No data returned by query</p>
        </div>
      )}
    </div>
  );
}
