import { DotsThree } from "@phosphor-icons/react/DotsThree";
import { Star } from "@phosphor-icons/react/Star";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useClickOutside } from "../../hooks/useClickOutside";
import { trpc } from "../../lib/trpc";
import { ChartSkeleton } from "../common/ChartSkeleton";
import { ExplorationChart } from "../traces/ExplorationChart";

type StarredChart = {
  id: string;
  title: string | null;
  chartType: string | null;
  sql: string | null;
  xKey: string | null;
  yKeys: unknown;
  legend: unknown;
  exploreId: string;
  exploreName: string;
};

type LegendEntry = { key: string; label: string; color: string };

export function StarredChartCard({
  chart,
  projectId,
}: {
  chart: StarredChart;
  projectId: string;
}) {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [menuOpen, setMenuOpen] = useState(false);
  const [chartData, setChartData] = useState<Record<string, unknown>[] | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const removeStar = trpc.explores.unstarChart.useMutation({
    onSettled: () => {
      utils.explores.listStarred.invalidate();
    },
  });

  const requery = trpc.explores.requery.useMutation();

  // Fetch chart data on mount
  useEffect(() => {
    if (!chart.sql) return;
    let cancelled = false;
    requery
      .mutateAsync({ projectId, sql: chart.sql })
      .then((rows) => {
        if (!cancelled) setChartData(rows);
      })
      .catch(() => {
        if (!cancelled) setChartData([]);
      });
    return () => {
      cancelled = true;
    };
  }, [chart.sql, projectId]); // eslint-disable-line react-hooks/exhaustive-deps

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

        <div className="relative shrink-0 ml-2" ref={menuRef}>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
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

      {/* Legend */}
      {legend.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap mb-3">
          {legend.map((entry) => (
            <span
              key={entry.key}
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-[10px] text-zinc-400"
            >
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ backgroundColor: entry.color }}
              />
              {entry.label}
            </span>
          ))}
        </div>
      )}

      {/* Chart */}
      {chartData === null ? (
        <ChartSkeleton variant={chart.chartType === "bar" ? "bar" : "area"} />
      ) : chartData.length > 0 && chart.chartType && chart.xKey && yKeys.length > 0 ? (
        <ExplorationChart
          chartType={chart.chartType as "bar" | "line"}
          xKey={chart.xKey}
          yKeys={yKeys}
          legend={legend.length > 0 ? legend : undefined}
          data={chartData}
        />
      ) : (
        <div className="flex items-center justify-center rounded-md border border-dashed border-zinc-700 bg-zinc-900/50 py-12">
          <p className="text-xs text-zinc-500">No data returned by query</p>
        </div>
      )}
    </div>
  );
}
