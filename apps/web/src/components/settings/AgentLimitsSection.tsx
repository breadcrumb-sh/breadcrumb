import { useState, useEffect } from "react";
import { trpc } from "../../lib/trpc";

function formatCost(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatInterval(seconds: number): string {
  if (seconds >= 3600) return `${(seconds / 3600).toFixed(1)} hours`;
  return `${Math.round(seconds / 60)} minutes`;
}

export function AgentLimitsSection({ projectId }: { projectId: string }) {
  const limits = trpc.monitor.getLimits.useQuery({ projectId });
  const utils = trpc.useUtils();
  const updateLimits = trpc.monitor.updateLimits.useMutation({
    onSuccess: () => utils.monitor.getLimits.invalidate({ projectId }),
  });

  const [costLimit, setCostLimit] = useState("");
  const [scanInterval, setScanInterval] = useState("");

  useEffect(() => {
    if (limits.data) {
      setCostLimit(
        limits.data.monthlyCostLimitCents === 0
          ? ""
          : (limits.data.monthlyCostLimitCents / 100).toString(),
      );
      setScanInterval((limits.data.scanIntervalSeconds / 60).toString());
    }
  }, [limits.data]);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const dollars = parseFloat(costLimit.trim() || "0");
    const minutes = parseFloat(scanInterval.trim() || "5");
    if (isNaN(dollars) || dollars < 0) return;
    if (isNaN(minutes) || minutes < 1) return;
    updateLimits.mutate({
      projectId,
      monthlyCostLimitCents: Math.round(dollars * 100),
      scanIntervalSeconds: Math.round(minutes * 60),
    });
  };

  const isDirty = limits.data
    ? costLimit !== (limits.data.monthlyCostLimitCents === 0 ? "" : (limits.data.monthlyCostLimitCents / 100).toString()) ||
      scanInterval !== (limits.data.scanIntervalSeconds / 60).toString()
    : false;

  const d = limits.data;
  const spentCents = d?.monthUsage.costCents ?? 0;
  const limitCents = d?.monthlyCostLimitCents ?? 0;
  const pct = limitCents > 0 ? Math.min(100, (spentCents / limitCents) * 100) : 0;

  return (
    <section className="space-y-6 max-w-md">
      <div>
        <h3 className="text-sm font-semibold mb-1">Agent Limits</h3>
        <p className="text-xs text-zinc-400">
          Control the monitoring agent's spend and how frequently it scans for new issues.
        </p>
      </div>

      {d && (
        <div className="rounded-md border border-zinc-800 bg-zinc-900/50 p-4 space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-zinc-400">This month's spend</span>
            <span className="text-zinc-100 tabular-nums">
              {formatCost(spentCents)}
              {limitCents > 0 && <span className="text-zinc-500"> / {formatCost(limitCents)}</span>}
            </span>
          </div>

          {limitCents > 0 && (
            <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  pct > 90 ? "bg-red-500" : pct > 70 ? "bg-amber-500" : "bg-emerald-500"
                }`}
                style={{ width: `${pct}%` }}
              />
            </div>
          )}

          <div className="flex items-center justify-between text-xs text-zinc-500">
            <span>{d.monthUsage.calls} API {d.monthUsage.calls === 1 ? "call" : "calls"}</span>
            <span>
              {formatTokens(d.monthUsage.inputTokens)} in / {formatTokens(d.monthUsage.outputTokens)} out
            </span>
          </div>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-1.5">
            Monthly cost limit ($)
          </label>
          <input
            type="number"
            value={costLimit}
            onChange={(e) => setCostLimit(e.target.value)}
            placeholder="Unlimited"
            min={0}
            step={0.01}
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-zinc-500"
          />
          <p className="text-xs text-zinc-500 mt-1.5">
            Estimated cost across all scans and investigations. Set to 0 for unlimited.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-1.5">
            Minimum time between auto-scans (minutes)
          </label>
          <input
            type="number"
            value={scanInterval}
            onChange={(e) => setScanInterval(e.target.value)}
            min={1}
            max={1440}
            step={1}
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-zinc-500"
          />
          <p className="text-xs text-zinc-500 mt-1.5">
            How often the agent checks incoming traces for new issues. Lower values increase responsiveness but use more budget.
          </p>
        </div>

        <button
          type="submit"
          disabled={updateLimits.isPending || !isDirty}
          className="rounded-md bg-zinc-100 px-4 py-1.5 text-sm font-medium text-zinc-900 hover:bg-zinc-200 transition-colors disabled:opacity-50"
        >
          Save
        </button>
      </form>
    </section>
  );
}
