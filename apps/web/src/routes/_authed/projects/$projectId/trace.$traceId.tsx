import { ArrowLeft } from "@phosphor-icons/react/ArrowLeft";
import { Check } from "@phosphor-icons/react/Check";
import { Copy } from "@phosphor-icons/react/Copy";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { trpc } from "../../../../lib/trpc";
import {
  buildTree,
  flattenTree,
  parseMs,
  formatCost,
  type SpanData,
  type SpanNode,
} from "../../../../lib/span-utils";
import { SpanRow } from "../../../../components/trace-detail/SpanRow";
import { SpanDetail } from "../../../../components/trace-detail/SpanDetail";
import { TraceChat } from "../../../../components/trace-detail/TraceChat";

import { fmtMs } from "../../../../components/trace-detail/helpers";
import { usePageView } from "../../../../hooks/usePageView";

export const Route = createFileRoute(
  "/_authed/projects/$projectId/trace/$traceId",
)({
  component: TraceDetailPage,
});

// ── Helpers ────────────────────────────────────────────────────────────────────

// Clean view: collapse redundant inner spans emitted by frameworks (e.g. AI
// SDK's doGenerate child that has the same name and type as the outer span).
// The collapsed span's children are promoted to its parent level so the useful
// structure (tool calls, nested agents) is preserved.
function collapseTree(
  nodes: SpanNode[],
  parentType?: string,
  parentName?: string,
): SpanNode[] {
  const result: SpanNode[] = [];
  for (const node of nodes) {
    const redundant =
      node.type === "llm" &&
      parentType === "llm" &&
      node.name === parentName;

    if (redundant) {
      result.push(...collapseTree(node.children, parentType, parentName));
    } else {
      result.push({
        ...node,
        children: collapseTree(node.children, node.type, node.name),
      });
    }
  }
  return result;
}

// ── Page ───────────────────────────────────────────────────────────────────────

function TraceDetailPage() {
  usePageView("trace_detail");
  const { projectId, traceId } = Route.useParams();
  const router = useRouter();
  const [selectedSpan, setSelectedSpan] = useState<SpanData | null>(null);
  const [copied, setCopied] = useState(false);
  const [leftTab, setLeftTab] = useState<"tree" | "chat">("tree");
  const [cleanView, setCleanView] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem("bc:clean-view");
      return stored === null ? true : stored === "true";
    } catch {
      return true;
    }
  });

  function toggleCleanView() {
    setCleanView((v) => {
      const next = !v;
      try { localStorage.setItem("bc:clean-view", String(next)); } catch {}
      return next;
    });
  }

  const trace = trpc.traces.get.useQuery({ projectId, traceId });
  const spans = trpc.traces.spans.useQuery({ projectId, traceId });
  const rawTree = spans.data ? buildTree(spans.data) : [];
  const tree = cleanView ? collapseTree(rawTree) : rawTree;

  // Compute trace-level summary from spans
  const totalCost = (spans.data ?? []).reduce(
    (s, sp) => s + sp.inputCostUsd + sp.outputCostUsd,
    0,
  );
  const totalTokens = (spans.data ?? []).reduce(
    (s, sp) => s + sp.inputTokens + sp.outputTokens,
    0,
  );
  const flat = flattenTree(tree);
  let traceMs = 0;
  if (flat.length) {
    let earliest = Infinity;
    let latest = -Infinity;
    for (const s of flat) {
      const start = parseMs(s.startTime);
      const end = parseMs(s.endTime);
      if (start < earliest) earliest = start;
      if (end > latest) latest = end;
    }
    traceMs = latest - earliest;
  }

  function copyTraceId() {
    navigator.clipboard.writeText(traceId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="flex flex-col h-[calc(100vh-53px-41px)]">
      {/* ── Header ── */}
      <div className="px-4 sm:px-8 py-4 shrink-0 flex items-center gap-4">
        {/* Left: back + name + copy */}
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => router.history.back()}
            className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors shrink-0"
          >
            <ArrowLeft size={13} />
            Traces
          </button>
          <div className="h-3 w-px bg-zinc-800 shrink-0" />
          <span className="text-sm font-medium text-zinc-100 truncate">
            {trace.data?.name ?? traceId}
          </span>
          <button
            onClick={copyTraceId}
            className="shrink-0 text-zinc-600 hover:text-zinc-300 transition-colors"
            title="Copy trace ID"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </button>
        </div>

        {/* Right: stats */}
        {spans.data && (
          <div className="ml-auto flex items-center gap-3 text-[11px] text-zinc-500 shrink-0">
            <span>{spans.data.length} spans</span>
            {totalTokens > 0 && (
              <span>{totalTokens.toLocaleString()} tokens</span>
            )}
            {totalCost > 0 && <span>{formatCost(totalCost)}</span>}
            {traceMs > 0 && <span>{fmtMs(traceMs)}</span>}
          </div>
        )}
      </div>

      {/* ── Body ── */}
      <div className="px-4 sm:px-8 pb-4 pt-2 flex-1 min-h-0 overflow-y-auto sm:overflow-visible">
        {spans.isLoading ? (
          <div className="flex items-center justify-center h-full text-sm text-zinc-600">
            Loading…
          </div>
        ) : !tree.length ? (
          <div className="flex items-center justify-center h-full text-sm text-zinc-600">
            No spans recorded
          </div>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:h-full sm:overflow-hidden">
            {/* Span list / Chat */}
            <div className="flex flex-col rounded-lg border border-zinc-800 sm:w-[420px] sm:shrink-0 sm:overflow-hidden">
              {/* Header with tab toggle */}
              <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800/60 shrink-0">
                <div className="flex items-center bg-zinc-900 border border-zinc-800 rounded-md p-0.5 gap-0.5">
                  {(["tree", "chat"] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setLeftTab(t)}
                      className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                        leftTab === t
                          ? "bg-zinc-800 text-zinc-100"
                          : "text-zinc-500 hover:text-zinc-300"
                      }`}
                    >
                      {t === "tree" ? "Tree" : "Chat"}
                    </button>
                  ))}
                </div>
                {leftTab === "tree" && (
                  <button
                    onClick={toggleCleanView}
                    className={`text-[11px] font-medium px-2 py-1 rounded transition-colors ${
                      cleanView
                        ? "text-zinc-100 bg-zinc-700/60"
                        : "text-zinc-500 hover:text-zinc-300"
                    }`}
                  >
                    Clean view
                  </button>
                )}
              </div>

              {leftTab === "tree" ? (
                <div className="flex-1 overflow-y-auto">
                  {tree.map((node) => (
                    <SpanRow
                      key={node.id}
                      node={node}
                      depth={0}
                      selectedId={selectedSpan?.id ?? null}
                      onSelect={setSelectedSpan}
                    />
                  ))}
                </div>
              ) : (
                <TraceChat traceId={traceId} />
              )}
            </div>

            {/* Span detail */}
            <div className="rounded-lg border border-zinc-800 sm:flex-1 sm:overflow-hidden bg-zinc-950">
              {selectedSpan ? (
                <SpanDetail span={selectedSpan} />
              ) : (
                <div className="flex items-center justify-center py-10 sm:py-0 sm:h-full text-xs text-zinc-600">
                  Select a span to view details
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
