import {
  ArrowLeft,
  CaretDown,
  CaretRight,
  CheckCircle,
  XCircle,
} from "@phosphor-icons/react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { trpc } from "../../../../lib/trpc";

export const Route = createFileRoute(
  "/_authed/projects/$projectId/trace/$traceId",
)({
  component: TraceDetailPage,
});

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
    spans.map((s) => [s.id, { ...s, children: [] }]),
  );
  const roots: SpanNode[] = [];

  for (const node of map.values()) {
    if (node.parentSpanId) {
      const parent = map.get(node.parentSpanId);
      if (parent) parent.children.push(node);
      else roots.push(node);
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

function spanDurationMs(start: string, end: string): number {
  return parseMs(end) - parseMs(start);
}

function fmtMs(ms: number): string {
  if (!ms || ms < 0) return "—";
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

function formatCost(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.001) return `$${usd.toFixed(6)}`;
  if (usd < 1) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function formatTime(chDate: string): string {
  return new Date(chDate.replace(" ", "T") + "Z").toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

const TYPE_CLASSES: Record<string, string> = {
  llm: "text-purple-400 bg-purple-400/10 border-purple-400/20",
  tool: "text-blue-400 bg-blue-400/10 border-blue-400/20",
  retrieval: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20",
};
function typeClass(type: string) {
  return (
    TYPE_CLASSES[type] ?? "text-zinc-400 bg-zinc-400/10 border-zinc-400/20"
  );
}

const BAR_CLASSES: Record<string, string> = {
  llm: "bg-purple-500/40 border border-purple-500/60",
  tool: "bg-blue-500/40 border border-blue-500/60",
  retrieval: "bg-emerald-500/40 border border-emerald-500/60",
};
function barClass(type: string) {
  return BAR_CLASSES[type] ?? "bg-zinc-500/40 border border-zinc-500/60";
}

// ── Span tree row ──────────────────────────────────────────────────────────────

function SpanRow({
  node,
  depth,
  selectedId,
  onSelect,
}: {
  node: SpanNode;
  depth: number;
  selectedId: string | null;
  onSelect: (span: SpanData) => void;
}) {
  const [open, setOpen] = useState(true);
  const hasChildren = node.children.length > 0;
  const isSelected = node.id === selectedId;
  const dur = fmtMs(spanDurationMs(node.startTime, node.endTime));
  const totalTokens = node.inputTokens + node.outputTokens;
  const totalCost = node.inputCostUsd + node.outputCostUsd;

  return (
    <>
      <div
        className={`flex items-center gap-2 py-2 pr-4 cursor-pointer transition-colors ${
          isSelected ? "bg-zinc-800/80" : "hover:bg-zinc-900/60"
        }`}
        style={{ paddingLeft: `${12 + depth * 18}px` }}
        onClick={() => onSelect(node)}
      >
        {/* Expand toggle */}
        <button
          className="shrink-0 w-4 flex items-center justify-center text-zinc-600 hover:text-zinc-400"
          onClick={(e) => {
            e.stopPropagation();
            setOpen((o) => !o);
          }}
        >
          {hasChildren ? (
            open ? (
              <CaretDown size={10} />
            ) : (
              <CaretRight size={10} />
            )
          ) : (
            <span className="w-2.5" />
          )}
        </button>

        {/* Status dot */}
        <span
          className={`shrink-0 size-1.5 rounded-full ${
            node.status === "error" ? "bg-red-500" : "bg-emerald-500"
          }`}
        />

        {/* Name + badge */}
        <span className="text-xs text-zinc-100 font-medium truncate flex-1 min-w-0">
          {node.name}
        </span>
        <span
          className={`shrink-0 inline-flex items-center rounded border px-1.5 py-px text-[10px] font-medium leading-none ${typeClass(node.type)}`}
        >
          {node.type}
        </span>

        {/* Duration */}
        <span className="shrink-0 text-[11px] text-zinc-500 tabular-nums w-12 text-right">
          {dur}
        </span>

        {/* Tokens */}
        {totalTokens > 0 && (
          <span className="shrink-0 text-[11px] text-zinc-600 tabular-nums w-14 text-right">
            {totalTokens.toLocaleString()}t
          </span>
        )}

        {/* Cost */}
        {totalCost > 0 && (
          <span className="shrink-0 text-[11px] text-zinc-600 tabular-nums w-16 text-right">
            {formatCost(totalCost)}
          </span>
        )}
      </div>

      {open &&
        node.children.map((child) => (
          <SpanRow
            key={child.id}
            node={child}
            depth={depth + 1}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        ))}
    </>
  );
}

// ── Span detail panel ──────────────────────────────────────────────────────────

function SpanDetail({ span }: { span: SpanData }) {
  const dur = fmtMs(spanDurationMs(span.startTime, span.endTime));
  const totalCost = span.inputCostUsd + span.outputCostUsd;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Span header */}
      <div className="px-5 py-4 border-b border-zinc-800 shrink-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className="text-sm font-semibold text-zinc-100">
            {span.name}
          </span>
          <span
            className={`inline-flex items-center rounded border px-1.5 py-px text-[10px] font-medium leading-none ${typeClass(span.type)}`}
          >
            {span.type}
          </span>
          {span.status === "error" ? (
            <span className="inline-flex items-center gap-1 text-xs text-red-400">
              <XCircle size={12} weight="fill" /> error
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
              <CheckCircle size={12} weight="fill" /> ok
            </span>
          )}
        </div>
        <div className="flex items-center gap-4 text-[11px] text-zinc-500 flex-wrap">
          {span.model && <span className="font-mono">{span.model}</span>}
          <span>{dur}</span>
          {span.inputTokens > 0 && (
            <span>
              {span.inputTokens.toLocaleString()} in /{" "}
              {span.outputTokens.toLocaleString()} out
            </span>
          )}
          {totalCost > 0 && <span>{formatCost(totalCost)}</span>}
        </div>
        <div className="mt-1.5 text-[10px] text-zinc-600 font-mono">
          {formatTime(span.startTime)}
        </div>
        {span.status === "error" && span.statusMessage && (
          <div className="mt-2 text-xs text-red-400">{span.statusMessage}</div>
        )}
      </div>

      {/* Input / Output / Metadata */}
      <div className="flex-1 overflow-y-auto divide-y divide-zinc-800">
        {span.input && <Section label="Input" content={span.input} />}
        {span.output && <Section label="Output" content={span.output} />}
        {span.metadata &&
          span.metadata !== "{}" &&
          span.metadata !== "null" && (
            <Section label="Metadata" content={span.metadata} />
          )}
        {!span.input && !span.output && (
          <div className="flex items-center justify-center py-12 text-xs text-zinc-600">
            No input or output recorded
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ label, content }: { label: string; content: string }) {
  return (
    <div className="px-5 py-4">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">
        {label}
      </p>
      <pre className="text-xs text-zinc-300 whitespace-pre-wrap break-all font-mono leading-relaxed">
        {tryPrettyJson(content)}
      </pre>
    </div>
  );
}

// ── Timeline view ──────────────────────────────────────────────────────────────

function TimelineView({ tree }: { tree: SpanNode[] }) {
  const flat = flattenTree(tree);
  if (!flat.length) return null;

  const allMs = flat.flatMap((s) => [parseMs(s.startTime), parseMs(s.endTime)]);
  const minT = Math.min(...allMs);
  const maxT = Math.max(...allMs);
  const totalMs = maxT - minT || 1;
  const totalDur = fmtMs(totalMs);

  return (
    <div className="py-2">
      {/* Scale axis */}
      <div className="flex items-center h-6 pr-4 mb-1">
        <div className="w-52 shrink-0" />
        <div className="flex-1 flex justify-between items-center mx-4 text-[10px] text-zinc-600">
          <span>0</span>
          <span>{totalDur}</span>
        </div>
        <div className="w-16 shrink-0" />
      </div>

      {flat.map((span) => {
        const leftPct = ((parseMs(span.startTime) - minT) / totalMs) * 100;
        const widthPct = Math.max(
          ((parseMs(span.endTime) - parseMs(span.startTime)) / totalMs) * 100,
          0.4,
        );
        const dur = fmtMs(spanDurationMs(span.startTime, span.endTime));

        return (
          <div
            key={span.id}
            className="flex items-center h-9 hover:bg-zinc-900/50 transition-colors"
          >
            {/* Name */}
            <div
              className="w-52 shrink-0 flex items-center gap-1.5 pr-2 overflow-hidden"
              style={{ paddingLeft: `${12 + span.depth * 12}px` }}
            >
              <span
                className={`shrink-0 size-1.5 rounded-full ${span.status === "error" ? "bg-red-500" : "bg-emerald-500"}`}
              />
              <span className="text-xs text-zinc-200 truncate">
                {span.name}
              </span>
            </div>

            {/* Bar */}
            <div className="flex-1 relative h-5 mx-4">
              <div className="absolute inset-0 rounded bg-zinc-900" />
              <div
                className={`absolute h-full rounded ${barClass(span.type)}`}
                style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
              />
            </div>

            {/* Duration */}
            <div className="w-16 shrink-0 pr-4 text-right text-[11px] text-zinc-500 tabular-nums">
              {dur}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

function TraceDetailPage() {
  const { projectId, traceId } = Route.useParams();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("tree");
  const [selectedSpan, setSelectedSpan] = useState<SpanData | null>(null);

  const spans = trpc.traces.spans.useQuery({ projectId, traceId });
  const tree = spans.data ? buildTree(spans.data) : [];
  const flat = flattenTree(tree);

  // Compute trace-level summary from spans
  const totalCost = (spans.data ?? []).reduce(
    (s, sp) => s + sp.inputCostUsd + sp.outputCostUsd,
    0,
  );
  const totalTokens = (spans.data ?? []).reduce(
    (s, sp) => s + sp.inputTokens + sp.outputTokens,
    0,
  );
  const traceMs = flat.length
    ? Math.max(...flat.map((s) => parseMs(s.endTime))) -
      Math.min(...flat.map((s) => parseMs(s.startTime)))
    : 0;

  return (
    <div className="flex flex-col h-[calc(100vh-53px-41px)]">
      {/* ── Subheader ── */}
      <div className="px-4 sm:px-8 py-3 border-b border-zinc-800 flex items-center gap-4 shrink-0">
        <button
          onClick={() => router.history.back()}
          className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors shrink-0"
        >
          <ArrowLeft size={13} />
          Traces
        </button>

        <div className="h-3 w-px bg-zinc-800 shrink-0" />

        <div className="min-w-0 flex-1 flex items-center gap-3">
          <span className="text-xs text-zinc-500 font-mono truncate">
            {traceId}
          </span>
          {spans.data && (
            <div className="flex items-center gap-3 text-[11px] text-zinc-500 shrink-0">
              <span>{spans.data.length} spans</span>
              {totalTokens > 0 && (
                <span>{totalTokens.toLocaleString()} tokens</span>
              )}
              {totalCost > 0 && <span>{formatCost(totalCost)}</span>}
              {traceMs > 0 && <span>{fmtMs(traceMs)}</span>}
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex items-center bg-zinc-950 border border-zinc-800 rounded-md p-0.5 gap-0.5 shrink-0">
          {(["tree", "timeline"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
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

      {/* ── Body ── */}
      {spans.isLoading ? (
        <div className="flex items-center justify-center flex-1 text-sm text-zinc-600">
          Loading…
        </div>
      ) : !tree.length ? (
        <div className="flex items-center justify-center flex-1 text-sm text-zinc-600">
          No spans recorded
        </div>
      ) : tab === "timeline" ? (
        <div className="flex-1 overflow-y-auto">
          <TimelineView tree={tree} />
        </div>
      ) : (
        /* Tree: split panel */
        <div className="flex flex-1 overflow-hidden">
          {/* Left: span list */}
          <div className="flex flex-col w-[420px] shrink-0 border-r border-zinc-800 overflow-y-auto">
            {/* Column headers */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
              <span className="flex-1 text-[10px] font-medium text-zinc-600 uppercase tracking-wide pl-6">
                Span
              </span>
              <span className="text-[10px] font-medium text-zinc-600 uppercase tracking-wide w-12 text-right">
                Dur
              </span>
              <span className="text-[10px] font-medium text-zinc-600 uppercase tracking-wide w-14 text-right">
                Tokens
              </span>
              <span className="text-[10px] font-medium text-zinc-600 uppercase tracking-wide w-16 text-right">
                Cost
              </span>
            </div>
            <div className="flex-1">
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
          </div>

          {/* Right: span detail */}
          <div className="flex-1 overflow-hidden bg-zinc-950">
            {selectedSpan ? (
              <SpanDetail span={selectedSpan} />
            ) : (
              <div className="flex items-center justify-center h-full text-xs text-zinc-600">
                Select a span to view details
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
