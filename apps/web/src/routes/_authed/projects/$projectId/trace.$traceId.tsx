import { ArrowLeft } from "@phosphor-icons/react/ArrowLeft";
import { Check } from "@phosphor-icons/react/Check";
import { Copy } from "@phosphor-icons/react/Copy";
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
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

import { fmtMs } from "../../../../components/trace-detail/helpers";
import { usePageView } from "../../../../hooks/usePageView";

const searchSchema = z.object({
  span: z.string().optional(),
});

export const Route = createFileRoute(
  "/_authed/projects/$projectId/trace/$traceId",
)({
  component: TraceDetailPage,
  validateSearch: searchSchema,
});

// ── Helpers ────────────────────────────────────────────────────────────────────

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

/** Build a map from span ID → parent span ID for fast ancestor lookups. */
function buildParentMap(spans: SpanData[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const s of spans) {
    if (s.parentSpanId) map.set(s.id, s.parentSpanId);
  }
  return map;
}

/** Walk up from spanId to root, collecting all ancestor IDs (including self). */
function getAncestorIds(spanId: string, parentMap: Map<string, string>): Set<string> {
  const ids = new Set<string>();
  let current: string | undefined = spanId;
  while (current) {
    ids.add(current);
    current = parentMap.get(current);
  }
  return ids;
}

// ── Page ───────────────────────────────────────────────────────────────────────

function TraceDetailPage() {
  usePageView("trace_detail");
  const { projectId, traceId } = Route.useParams();
  const { span: spanParam } = Route.useSearch();
  const router = useRouter();
  const navigate = useNavigate({ from: Route.fullPath });
  const utils = trpc.useUtils();
  const [copied, setCopied] = useState(false);
  const [forceExpandIds, setForceExpandIds] = useState<Set<string> | undefined>();
  const treeContainerRef = useRef<HTMLDivElement>(null);

  // Save the TanStack Router history index on mount so we can jump back
  // past all intra-page navigations (span clicks, ask param) to the
  // page the user came from (usually the traces list with its query params).
  const entryIndexRef = useRef(
    (router.state.location.state as { __TSR_index?: number }).__TSR_index ?? 0,
  );

  const goBackToTraces = useCallback(() => {
    const currentIndex =
      (router.state.location.state as { __TSR_index?: number }).__TSR_index ?? 0;
    const stepsBack = currentIndex - entryIndexRef.current + 1;
    if (stepsBack > 0 && entryIndexRef.current > 0) {
      window.history.go(-stepsBack);
    } else {
      void navigate({
        to: "/projects/$projectId/traces",
        params: { projectId },
      });
    }
  }, [router, navigate, projectId]);
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
  const cleanTree = useMemo(() => collapseTree(rawTree), [rawTree]);
  const cleanViewHasEffect = flattenTree(rawTree).length !== flattenTree(cleanTree).length;
  const tree = cleanView ? cleanTree : rawTree;

  const parentMap = useMemo(
    () => (spans.data ? buildParentMap(spans.data) : new Map<string, string>()),
    [spans.data],
  );

  // Derive selected span from URL (single source of truth)
  const selectedSpan = useMemo(
    () => (spanParam && spans.data ? spans.data.find((s) => s.id === spanParam) ?? null : null),
    [spanParam, spans.data],
  );

  // Navigate to select/deselect a span — URL drives everything
  const selectSpan = useCallback(
    (span: SpanData | null) => {
      void navigate({
        search: (prev) => ({ ...prev, span: span?.id }),
      });
    },
    [navigate],
  );

  // Expand ancestors and scroll into view when spanParam changes
  useEffect(() => {
    if (!spanParam || !spans.data) return;
    const ancestors = getAncestorIds(spanParam, parentMap);
    setForceExpandIds(ancestors);
    requestAnimationFrame(() => {
      const el = treeContainerRef.current?.querySelector(`[data-span-id="${spanParam}"]`);
      el?.scrollIntoView({ behavior: "instant", block: "nearest" });
    });
  }, [spanParam, spans.data, parentMap]);


  // ── Trace stats ──────────────────────────────────────────────────────────
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
    <div className="flex flex-col h-[calc(100vh-48px)]">
      {/* ── Header ── */}
      <div className="px-4 sm:px-8 pt-6 pb-2 shrink-0 flex items-center gap-4">
        {/* Left: back + name + copy */}
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={goBackToTraces}
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

        {/* Right: stats + analyze */}
        <div className="ml-auto flex items-center gap-3 shrink-0">
          {spans.data && (
            <div className="flex items-center gap-3 text-[11px] text-zinc-500">
              <span>{spans.data.length} spans</span>
              {totalTokens > 0 && (
                <span>{totalTokens.toLocaleString()} tokens</span>
              )}
              {totalCost > 0 && <span>{formatCost(totalCost)}</span>}
              {traceMs > 0 && <span>{fmtMs(traceMs)}</span>}
            </div>
          )}

        </div>
      </div>

      {/* ── Body ── */}
      <div className="px-4 sm:px-8 pb-4 pt-2 flex-1 min-h-0 overflow-hidden">
        {spans.isLoading ? (
          <div className="flex items-center justify-center h-full text-sm text-zinc-500">
            Loading…
          </div>
        ) : !tree.length ? (
          <div className="flex items-center justify-center h-full text-sm text-zinc-500">
            No spans recorded
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row sm:h-full sm:overflow-hidden rounded-lg border border-zinc-800">
            {/* Span tree */}
            <div className="flex flex-col sm:w-[420px] sm:shrink-0 sm:overflow-hidden border-b sm:border-b-0 sm:border-r border-zinc-800">
              <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800/60 shrink-0">
                <span className="text-[11px] font-medium text-zinc-400">
                  Spans
                </span>
                {cleanViewHasEffect && (
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

              <div ref={treeContainerRef} className="flex-1 overflow-y-auto">
                {tree.map((node) => (
                  <SpanRow
                    key={node.id}
                    node={node}
                    depth={0}
                    selectedId={selectedSpan?.id ?? null}
                    onSelect={selectSpan}
                    forceExpandIds={forceExpandIds}
                  />
                ))}
              </div>
            </div>

            {/* Right panel: span detail / empty */}
            <div className="sm:flex-1 sm:overflow-hidden bg-zinc-950">
              {selectedSpan ? (
                <div className="h-full flex flex-col overflow-hidden">
                  <div className="flex-1 overflow-hidden">
                    <SpanDetail
                      span={selectedSpan}
                    />
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center py-10 sm:py-0 sm:h-full text-xs text-zinc-500">
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
