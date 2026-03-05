import {
  ArrowLeft,
  CaretDown,
  CaretRight,
  Check,
  CheckCircle,
  Copy,
  XCircle,
} from "@phosphor-icons/react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { createHighlighter } from "shiki";
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

// ── JSON syntax highlighter (Shiki) ───────────────────────────────────────────

const highlighterPromise = createHighlighter({
  themes: ["github-light", "github-dark"],
  langs: ["json"],
});

function JsonHighlight({ content }: { content: string }) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    highlighterPromise.then((hl) => {
      setHtml(
        hl.codeToHtml(content, {
          lang: "json",
          themes: { light: "github-light", dark: "github-dark" },
          defaultColor: false,
        }),
      );
    });
  }, [content]);

  if (html === null) {
    return (
      <pre className="text-xs text-zinc-300 whitespace-pre-wrap break-all font-mono leading-relaxed">
        {content}
      </pre>
    );
  }

  return (
    // eslint-disable-next-line react/no-danger
    <div className="json-highlight" dangerouslySetInnerHTML={{ __html: html }} />
  );
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

        {/* Status dot — only shown on error */}
        {node.status === "error" ? (
          <span className="shrink-0 size-1.5 rounded-full bg-red-500" />
        ) : (
          <span className="shrink-0 size-1.5" />
        )}

        {/* Name + badge */}
        <span className="text-xs text-zinc-100 font-medium truncate flex-1 min-w-0">
          {node.name}
        </span>
        <span
          className={`shrink-0 inline-flex items-center rounded border px-1.5 py-[2px] text-[10px] font-medium leading-none ${typeClass(node.type)}`}
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
            className={`inline-flex items-center rounded border px-1.5 py-[2px] text-[10px] font-medium leading-none ${typeClass(span.type)}`}
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
      <div className="flex-1 overflow-y-auto">
        {span.input && <Section label="Input" content={span.input} collapsible />}
        {span.output && <Section label="Output" content={span.output} collapsible />}
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

// ── Chat message renderer ──────────────────────────────────────────────────────

type ChatMessage = { role: string; content: unknown };

function isChatMessages(data: unknown): data is ChatMessage[] {
  return (
    Array.isArray(data) &&
    data.length > 0 &&
    typeof (data[0] as Record<string, unknown>)?.role === "string"
  );
}

const ROLE_STYLES: Record<
  string,
  { labelCls: string; borderCls: string; bgCls: string }
> = {
  system: {
    labelCls: "text-amber-400",
    borderCls: "border-amber-500/20",
    bgCls: "bg-amber-500/5",
  },
  user: {
    labelCls: "text-zinc-300",
    borderCls: "border-zinc-700",
    bgCls: "bg-zinc-800/40",
  },
  assistant: {
    labelCls: "text-purple-400",
    borderCls: "border-purple-500/20",
    bgCls: "bg-purple-500/5",
  },
  tool: {
    labelCls: "text-blue-400",
    borderCls: "border-blue-500/20",
    bgCls: "bg-blue-500/5",
  },
};

function MessageContent({ content }: { content: unknown }) {
  if (typeof content === "string") {
    return (
      <pre className="text-xs text-zinc-300 whitespace-pre-wrap break-words font-mono leading-relaxed">
        {content}
      </pre>
    );
  }
  if (Array.isArray(content)) {
    return (
      <div className="space-y-1">
        {(content as Array<Record<string, unknown>>).map((part, i) => {
          if (part.type === "text" && typeof part.text === "string") {
            return (
              <pre
                key={i}
                className="text-xs text-zinc-300 whitespace-pre-wrap break-words font-mono leading-relaxed"
              >
                {part.text}
              </pre>
            );
          }
          if (part.type === "tool-call") {
            return (
              <div
                key={i}
                className="text-xs font-mono text-blue-300 bg-blue-500/10 rounded px-2 py-1"
              >
                <span className="text-blue-400 font-semibold">
                  tool_call:{" "}
                </span>
                {String(part.toolName)}(
                {JSON.stringify(part.input ?? part.args, null, 2)})
              </div>
            );
          }
          if (part.type === "tool-result") {
            return (
              <div
                key={i}
                className="text-xs font-mono text-emerald-300 bg-emerald-500/10 rounded px-2 py-1"
              >
                <span className="text-emerald-400 font-semibold">
                  tool_result:{" "}
                </span>
                {JSON.stringify(part.result, null, 2)}
              </div>
            );
          }
          return (
            <pre
              key={i}
              className="text-xs text-zinc-400 whitespace-pre-wrap break-words font-mono leading-relaxed"
            >
              {JSON.stringify(part, null, 2)}
            </pre>
          );
        })}
      </div>
    );
  }
  return (
    <pre className="text-xs text-zinc-300 whitespace-pre-wrap break-words font-mono leading-relaxed">
      {JSON.stringify(content, null, 2)}
    </pre>
  );
}

function ChatMessagesView({ messages }: { messages: ChatMessage[] }) {
  return (
    <div className="space-y-2">
      {messages.map((msg, i) => {
        const styles = ROLE_STYLES[msg.role] ?? ROLE_STYLES.user;
        return (
          <div
            key={i}
            className={`rounded border ${styles.borderCls} ${styles.bgCls} px-3 py-2.5`}
          >
            <div
              className={`text-[10px] font-semibold uppercase tracking-widest mb-1.5 ${styles.labelCls}`}
            >
              {msg.role}
            </div>
            <MessageContent content={msg.content} />
          </div>
        );
      })}
    </div>
  );
}

const SECTION_STORAGE_KEY = "bc:span-section-collapsed";

function useSectionCollapsed(label: string): [boolean, () => void] {
  const key = label.toLowerCase();

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(SECTION_STORAGE_KEY);
      const map: Record<string, boolean> = stored ? JSON.parse(stored) : {};
      return map[key] ?? false;
    } catch {
      return false;
    }
  });

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        const stored = localStorage.getItem(SECTION_STORAGE_KEY);
        const map: Record<string, boolean> = stored ? JSON.parse(stored) : {};
        map[key] = next;
        localStorage.setItem(SECTION_STORAGE_KEY, JSON.stringify(map));
      } catch { /* ignore */ }
      return next;
    });
  }

  return [collapsed, toggle];
}

function Section({ label, content, collapsible = false }: { label: string; content: string; collapsible?: boolean }) {
  const [collapsed, toggle] = useSectionCollapsed(label);

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(content);
  } catch {
    /* not JSON */
  }

  const messages = isChatMessages(parsed) ? parsed : null;
  const isOpen = !collapsible || !collapsed;

  return (
    <div className="border-b border-zinc-800 last:border-b-0">
      <button
        onClick={collapsible ? toggle : undefined}
        className={`w-full flex items-center justify-between px-5 py-3 ${collapsible ? "cursor-pointer hover:bg-zinc-900/50 transition-colors" : "cursor-default"}`}
      >
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          {label}
        </span>
        {collapsible && (
          <CaretDown
            size={11}
            className={`text-zinc-600 transition-transform duration-150 ${collapsed ? "-rotate-90" : ""}`}
          />
        )}
      </button>
      {isOpen && (
        <div className="px-5 pb-4">
          {messages ? (
            <ChatMessagesView messages={messages} />
          ) : typeof parsed === "string" ? (
            <pre className="text-xs text-zinc-300 whitespace-pre-wrap break-all font-mono leading-relaxed">
              {parsed}
            </pre>
          ) : (
            <JsonHighlight content={tryPrettyJson(content)} />
          )}
        </div>
      )}
    </div>
  );
}

// ── Span minimap ───────────────────────────────────────────────────────────────

const MINIMAP_COLOR: Record<string, string> = {
  llm:       "var(--minimap-llm)",
  tool:      "var(--minimap-tool)",
  retrieval: "var(--minimap-retrieval)",
  step:      "var(--minimap-step)",
};

function formatMinimapTime(ms: number): string {
  if (ms < 1000) return `+${ms}ms`;
  return `+${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)}s`;
}

// Minimum gap between bars as a percent of the bar area.
// At ~800px wide (768px inset) this is ~3.8px — enough to see each bar.
const MIN_BAR_GAP = 0.5;

function computeBarPositions(spans: FlatSpan[], minT: number, totalMs: number) {
  // Sort by start time so the bump pass works left-to-right.
  const sorted = [...spans].sort(
    (a, b) => parseMs(a.startTime) - parseMs(b.startTime),
  );

  // Raw time-based positions (0–100).
  const raw = sorted.map(
    (s) => ((parseMs(s.startTime) - minT) / totalMs) * 100,
  );

  // Bump pass: push each bar forward if it would overlap the previous one.
  const bumped = raw.reduce<number[]>((acc, pct, i) => {
    if (i === 0) return [pct];
    return [...acc, Math.max(pct, acc[acc.length - 1] + MIN_BAR_GAP)];
  }, []);

  return new Map(sorted.map((s, i) => [s.id, bumped[i]]));
}

function SpanMinimap({
  spans,
  selectedId,
  onSelect,
}: {
  spans: FlatSpan[];
  selectedId: string | null;
  onSelect: (span: SpanData) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const [dragPct, setDragPct] = useState<number | null>(null);

  if (!spans.length) return null;

  const times = spans.flatMap((s) => [parseMs(s.startTime), parseMs(s.endTime)]);
  const minT = Math.min(...times);
  const maxT = Math.max(...times);
  const totalMs = maxT - minT || 1;

  const barPositions = computeBarPositions(spans, minT, totalMs);

  // Cursor: drag position while scrubbing, otherwise snap to selected span.
  const selectedPct = selectedId != null ? (barPositions.get(selectedId) ?? null) : null;
  const cursorPct = dragPct ?? selectedPct;

  function pctFromMouse(e: MouseEvent | React.MouseEvent): number {
    const rect = containerRef.current!.getBoundingClientRect();
    const insetW = rect.width - 32;
    return Math.max(0, Math.min(1, (e.clientX - rect.left - 16) / insetW));
  }

  // Snap cursor to the nearest bar by display position, not raw time.
  function selectAt(pct: number) {
    const target = pct * 100;
    let nearest = spans[0];
    let minDist = Infinity;
    for (const span of spans) {
      const dist = Math.abs((barPositions.get(span.id) ?? 0) - target);
      if (dist < minDist) { minDist = dist; nearest = span; }
    }
    onSelect(nearest);
  }

  function handleMouseDown(e: React.MouseEvent) {
    isDragging.current = true;
    const pct = pctFromMouse(e);
    setDragPct(pct * 100);
    selectAt(pct);
  }

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!isDragging.current || !containerRef.current) return;
      const pct = pctFromMouse(e);
      setDragPct(pct * 100);
      selectAt(pct);
    }
    function onUp() {
      if (!isDragging.current) return;
      isDragging.current = false;
      setDragPct(null);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spans, minT, totalMs, onSelect]);

  return (
    <div className="px-4 sm:px-8 pb-1 shrink-0">
      <div
        ref={containerRef}
        onMouseDown={handleMouseDown}
        className="relative h-11 rounded-lg border border-zinc-800 bg-zinc-900 overflow-hidden cursor-col-resize select-none"
      >
        {/* Bars */}
        <div className="absolute inset-y-0 left-4 right-4 pointer-events-none">
          {spans.map((span) => {
            const leftPct = barPositions.get(span.id) ?? 0;
            const color = MINIMAP_COLOR[span.type] ?? "var(--minimap-default)";
            return (
              <div
                key={span.id}
                style={{ left: `${leftPct}%`, backgroundColor: color }}
                className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-0.5 h-3.5 rounded-full"
              />
            );
          })}
        </div>

        {/* Playhead */}
        {cursorPct !== null && (
          <div
            className="absolute inset-y-0 w-2 -translate-x-1/2 pointer-events-none"
            style={{
              left: `calc(1rem + ${(cursorPct / 100).toFixed(6)} * (100% - 2rem))`,
              backgroundColor: "var(--minimap-cursor)",
              borderLeft: "1px solid var(--minimap-cursor-border)",
              borderRight: "1px solid var(--minimap-cursor-border)",
            }}
          />
        )}
      </div>
      <div className="flex justify-between mt-1 px-0.5">
        <span className="text-[9px] font-mono text-zinc-600">+0s</span>
        <span className="text-[9px] font-mono text-zinc-600">{formatMinimapTime(totalMs)}</span>
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

function TraceDetailPage() {
  const { projectId, traceId } = Route.useParams();
  const router = useRouter();
  const [selectedSpan, setSelectedSpan] = useState<SpanData | null>(null);
  const [copied, setCopied] = useState(false);

  const trace = trpc.traces.get.useQuery({ projectId, traceId });
  const spans = trpc.traces.spans.useQuery({ projectId, traceId });
  const tree = spans.data ? buildTree(spans.data) : [];

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
  const traceMs = flat.length
    ? Math.max(...flat.map((s) => parseMs(s.endTime))) -
      Math.min(...flat.map((s) => parseMs(s.startTime)))
    : 0;

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

      {/* ── Minimap ── */}
      {flat.length > 0 && (
        <SpanMinimap
          spans={flat}
          selectedId={selectedSpan?.id ?? null}
          onSelect={setSelectedSpan}
        />
      )}

      {/* ── Body ── */}
      <div className="px-4 sm:px-8 pb-4 pt-2 flex-1 min-h-0">
        {spans.isLoading ? (
          <div className="flex items-center justify-center h-full text-sm text-zinc-600">
            Loading…
          </div>
        ) : !tree.length ? (
          <div className="flex items-center justify-center h-full text-sm text-zinc-600">
            No spans recorded
          </div>
        ) : (
          <div className="flex h-full overflow-hidden rounded-lg border border-zinc-800">
            {/* Left: span list */}
            <div className="flex flex-col w-[420px] shrink-0 border-r border-zinc-800 overflow-y-auto">
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
    </div>
  );
}
