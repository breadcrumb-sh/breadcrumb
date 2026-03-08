import { useState } from "react";
import { X, CaretRight, CaretDown } from "@phosphor-icons/react";
import { trpc } from "../lib/trpc";

// ── Types ──────────────────────────────────────────────────────────────────────

type SpanData = {
  id: string;
  parentSpanId: string;
  name: string;
  type: string;
  status: "ok" | "error";
  statusMessage: string;
  startTime: string;
  endTime: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  inputCostUsd: number;
  outputCostUsd: number;
  input: string;
  output: string;
  metadata: string;
};

type SpanNode = SpanData & { children: SpanNode[] };
type FlatSpan = SpanData & { depth: number };
type Tab = "tree" | "timeline";

// ── Helpers ────────────────────────────────────────────────────────────────────

function buildTree(spans: SpanData[]): SpanNode[] {
  const map = new Map<string, SpanNode>(
    spans.map((s) => [s.id, { ...s, children: [] }])
  );
  const roots: SpanNode[] = [];

  for (const node of map.values()) {
    if (node.parentSpanId) {
      const parent = map.get(node.parentSpanId);
      if (parent) {
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    } else {
      roots.push(node);
    }
  }

  function sortByTime(nodes: SpanNode[]) {
    nodes.sort((a, b) => a.startTime.localeCompare(b.startTime));
    for (const n of nodes) sortByTime(n.children);
  }
  sortByTime(roots);

  return roots;
}

function flattenTree(nodes: SpanNode[], depth = 0): FlatSpan[] {
  const result: FlatSpan[] = [];
  for (const { children, ...span } of nodes) {
    result.push({ ...span, depth });
    result.push(...flattenTree(children, depth + 1));
  }
  return result;
}

function parseMs(chDate: string): number {
  return new Date(chDate.replace(" ", "T") + "Z").getTime();
}

function spanDuration(start: string, end: string): string {
  const ms = parseMs(end) - parseMs(start);
  if (!ms || ms < 0) return "";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function tryPrettyJson(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

const TYPE_CLASSES: Record<string, string> = {
  llm:       "text-purple-400 bg-purple-400/10 border-purple-400/20",
  tool:      "text-blue-400 bg-blue-400/10 border-blue-400/20",
  retrieval: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20",
};

function typeClass(type: string): string {
  return TYPE_CLASSES[type] ?? "text-zinc-400 bg-zinc-400/10 border-zinc-400/20";
}

const BAR_CLASSES: Record<string, string> = {
  llm:       "bg-purple-500/40 border border-purple-500/60",
  tool:      "bg-blue-500/40 border border-blue-500/60",
  retrieval: "bg-emerald-500/40 border border-emerald-500/60",
};

function barClass(type: string): string {
  return BAR_CLASSES[type] ?? "bg-zinc-500/40 border border-zinc-500/60";
}

// ── Tree view ─────────────────────────────────────────────────────────────────

function SpanItem({ node, depth }: { node: SpanNode; depth: number }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = !!(node.input || node.output);
  const dur = spanDuration(node.startTime, node.endTime);
  const totalTokens = node.inputTokens + node.outputTokens;
  const totalCost = node.inputCostUsd + node.outputCostUsd;

  return (
    <div>
      {/* Row */}
      <div
        className={`flex items-start gap-2 py-2 pr-4 transition-colors ${hasDetails ? "cursor-pointer hover:bg-zinc-900/60" : ""}`}
        style={{ paddingLeft: `${16 + depth * 20}px` }}
        onClick={() => hasDetails && setExpanded((e) => !e)}
      >
        {/* Expand caret */}
        <span className="shrink-0 mt-0.5 w-3.5 text-zinc-600">
          {hasDetails &&
            (expanded ? <CaretDown size={11} /> : <CaretRight size={11} />)}
        </span>

        {/* Status dot */}
        <span
          className={`shrink-0 mt-[5px] size-1.5 rounded-full ${
            node.status === "error" ? "bg-red-500" : "bg-emerald-500"
          }`}
        />

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-zinc-100 font-medium">{node.name}</span>
            {node.type !== "custom" && (
              <span
                className={`shrink-0 inline-flex items-center rounded border px-1.5 py-[2px] text-[10px] font-medium leading-none ${typeClass(node.type)}`}
              >
                {node.type}
              </span>
            )}
            {node.model && (
              <span className="shrink-0 text-[11px] text-zinc-500">{node.model}</span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-3 text-[11px] text-zinc-500">
            {dur && <span>{dur}</span>}
            {totalTokens > 0 && (
              <span>{totalTokens.toLocaleString()} tok</span>
            )}
            {totalCost > 0 && (
              <span>${totalCost < 0.001 ? totalCost.toFixed(6) : totalCost.toFixed(4)}</span>
            )}
            {node.status === "error" && node.statusMessage && (
              <span className="text-red-400 truncate">{node.statusMessage}</span>
            )}
          </div>
        </div>
      </div>

      {/* Expanded input/output */}
      {expanded && (
        <div
          className="mb-2 rounded-md border border-zinc-800 overflow-hidden text-xs"
          style={{ marginLeft: `${52 + depth * 20}px`, marginRight: "16px" }}
        >
          {node.input && (
            <div className="p-3 border-b border-zinc-800">
              <p className="text-zinc-500 mb-1.5 font-semibold uppercase tracking-wider text-[10px]">
                Input
              </p>
              <pre className="text-zinc-300 whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed max-h-52 overflow-y-auto">
                {tryPrettyJson(node.input)}
              </pre>
            </div>
          )}
          {node.output && (
            <div className="p-3">
              <p className="text-zinc-500 mb-1.5 font-semibold uppercase tracking-wider text-[10px]">
                Output
              </p>
              <pre className="text-zinc-300 whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed max-h-52 overflow-y-auto">
                {tryPrettyJson(node.output)}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Children */}
      {node.children.map((child) => (
        <SpanItem key={child.id} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

// ── Timeline view ─────────────────────────────────────────────────────────────

function TimelineView({ tree }: { tree: SpanNode[] }) {
  const flat = flattenTree(tree);
  if (flat.length === 0) return null;

  const allMs = flat.flatMap((s) => [parseMs(s.startTime), parseMs(s.endTime)]);
  const minT    = Math.min(...allMs);
  const maxT    = Math.max(...allMs);
  const totalMs = maxT - minT || 1;
  const totalDur = spanDuration(
    flat[0]!.startTime,
    flat.reduce((latest, s) =>
      parseMs(s.endTime) > parseMs(latest.endTime) ? s : latest
    ).endTime
  );

  return (
    <div className="py-2">
      {/* Scale axis */}
      <div className="flex items-center h-6 pr-4 mb-1">
        <div className="w-48 shrink-0" />
        <div className="flex-1 flex justify-between items-center mx-3 text-[10px] text-zinc-600">
          <span>0</span>
          <span>{totalDur}</span>
        </div>
        <div className="w-14 shrink-0" />
      </div>

      {flat.map((span) => {
        const leftPct  = ((parseMs(span.startTime) - minT) / totalMs) * 100;
        const widthPct = Math.max(((parseMs(span.endTime) - parseMs(span.startTime)) / totalMs) * 100, 0.5);
        const dur = spanDuration(span.startTime, span.endTime);

        return (
          <div
            key={span.id}
            className="flex items-center h-9 hover:bg-zinc-900/50 transition-colors"
          >
            {/* Name column */}
            <div
              className="w-48 shrink-0 flex items-center gap-1.5 pr-2 overflow-hidden"
              style={{ paddingLeft: `${12 + span.depth * 12}px` }}
            >
              <span
                className={`shrink-0 size-1.5 rounded-full ${
                  span.status === "error" ? "bg-red-500" : "bg-emerald-500"
                }`}
              />
              <span className="text-xs text-zinc-200 truncate">{span.name}</span>
            </div>

            {/* Bar area */}
            <div className="flex-1 relative h-5 mx-3">
              {/* Track */}
              <div className="absolute inset-0 rounded bg-zinc-900" />
              {/* Bar */}
              <div
                className={`absolute h-full rounded ${barClass(span.type)}`}
                style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
              />
            </div>

            {/* Duration */}
            <div className="w-14 shrink-0 pr-4 text-right text-[11px] text-zinc-500 tabular-nums">
              {dur}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── TraceSheet ─────────────────────────────────────────────────────────────────

export function TraceSheet({
  traceId,
  traceName,
  projectId,
  onClose,
}: {
  traceId: string | null;
  traceName?: string;
  projectId: string;
  onClose: () => void;
}) {
  const open = !!traceId;
  const [tab, setTab] = useState<Tab>("tree");

  const spans = trpc.traces.spans.useQuery(
    { projectId, traceId: traceId! },
    { enabled: open }
  );

  const tree = spans.data ? buildTree(spans.data) : [];

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-black/50 transition-opacity duration-300 ${
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className={`fixed right-0 top-0 z-50 h-full w-[640px] max-w-[calc(100vw-48px)] bg-zinc-950 border-l border-zinc-800 flex flex-col transition-transform duration-300 ease-in-out ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 shrink-0">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-zinc-100 truncate">
              {traceName ?? "Trace"}
            </p>
            {traceId && (
              <p className="text-[11px] text-zinc-500 font-mono mt-0.5 truncate">
                {traceId}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="shrink-0 ml-4 rounded p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center px-4 py-2.5 border-b border-zinc-800 shrink-0">
          <div className="flex items-center bg-zinc-900 border border-zinc-800 rounded-md p-0.5 gap-0.5">
            {(["tree", "timeline"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                  tab === t
                    ? "bg-zinc-800 text-zinc-100"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {t === "tree" ? "Tree" : "Timeline"}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {spans.isLoading ? (
            <div className="flex items-center justify-center h-32 text-sm text-zinc-600">
              Loading…
            </div>
          ) : !tree.length ? (
            <div className="flex items-center justify-center h-32 text-sm text-zinc-600">
              No spans recorded
            </div>
          ) : tab === "tree" ? (
            <div className="py-2">
              {tree.map((node) => (
                <SpanItem key={node.id} node={node} depth={0} />
              ))}
            </div>
          ) : (
            <TimelineView tree={tree} />
          )}
        </div>
      </div>
    </>
  );
}
