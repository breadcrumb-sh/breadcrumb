// ── Shared span types & helpers ──────────────────────────────────────────────

export type SpanData = {
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

export type SpanNode = SpanData & { children: SpanNode[] };
export type FlatSpan = SpanData & { depth: number };

// ── Tree building ───────────────────────────────────────────────────────────

export function buildTree(spans: SpanData[]): SpanNode[] {
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

export function flattenTree(nodes: SpanNode[], depth = 0): FlatSpan[] {
  const result: FlatSpan[] = [];
  for (const { children, ...span } of nodes) {
    result.push({ ...span, depth });
    result.push(...flattenTree(children, depth + 1));
  }
  return result;
}

// ── Parsing ─────────────────────────────────────────────────────────────────

export function parseMs(chDate: string): number {
  return new Date(chDate.replace(" ", "T") + "Z").getTime();
}

export function tryPrettyJson(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

// ── Type styles ─────────────────────────────────────────────────────────────

export const TYPE_CLASSES: Record<string, string> = {
  llm: "text-purple-400 bg-purple-400/10 border-purple-400/20",
  tool: "text-blue-400 bg-blue-400/10 border-blue-400/20",
  retrieval: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20",
};

export function typeClass(type: string) {
  return (
    TYPE_CLASSES[type] ?? "text-zinc-400 bg-zinc-400/10 border-zinc-400/20"
  );
}

// ── Formatters ──────────────────────────────────────────────────────────────

export function formatCost(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.001) return `$${usd.toFixed(6)}`;
  if (usd < 1) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

export function formatDurationMs(ms: number): string {
  if (!ms || ms <= 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatTokens(n: number): string {
  if (n === 0) return "0";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}
