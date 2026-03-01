import { Pulse, SpinnerGap } from "@phosphor-icons/react";
import {
  Background,
  BackgroundVariant,
  Position,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import { useMemo } from "react";

interface HappyPathEdge {
  parentName: string;
  parentType: string;
  childName: string;
  childType: string;
  traceCount: number;
}

interface TraceFlowGraphProps {
  edges: HappyPathEdge[];
  totalTraces: number;
  isLoading?: boolean;
}

const NODE_W = 150;
const NODE_H = 36;
const GAP_X = 100;
const GAP_Y = 52;

const TYPE_CLASSES: Record<string, string> = {
  llm: "!bg-purple-950 !border-purple-700 !text-purple-300",
  tool: "!bg-blue-950 !border-blue-700 !text-blue-300",
  retrieval: "!bg-emerald-950 !border-emerald-700 !text-emerald-300",
  step: "!bg-zinc-900 !border-zinc-700 !text-zinc-300",
  root: "!bg-zinc-800 !border-zinc-600 !text-zinc-100",
};

function classForType(type: string): string {
  return TYPE_CLASSES[type] ?? "!bg-zinc-800 !border-zinc-700 !text-zinc-300";
}

// Unique node key from name+type
const nk = (name: string, type: string) => `${name}\0${type}`;

/**
 * Build a left-to-right DAG layout from happy-path edges.
 *
 * 1. Assign columns via BFS (longest-path from roots).
 * 2. Sort rows within each column with barycenter heuristic
 *    to minimise edge crossings.
 * 3. Nodes with no parents are the entry points (column 0).
 */
function layoutGraph(rawEdges: HappyPathEdge[], totalTraces: number) {
  if (!rawEdges.length) return { nodes: [] as Node[], edges: [] as Edge[] };

  // ── Collect nodes & adjacency ──────────────────────────────────────────
  const nodeInfo = new Map<string, { name: string; type: string }>();
  const childrenOf = new Map<string, Map<string, number>>(); // parent -> child -> count
  const parentsOf = new Map<string, Map<string, number>>(); // child -> parent -> count

  for (const e of rawEdges) {
    const pk = nk(e.parentName, e.parentType);
    const ck = nk(e.childName, e.childType);
    nodeInfo.set(pk, { name: e.parentName, type: e.parentType });
    nodeInfo.set(ck, { name: e.childName, type: e.childType });

    if (!childrenOf.has(pk)) childrenOf.set(pk, new Map());
    childrenOf.get(pk)!.set(ck, e.traceCount);

    if (!parentsOf.has(ck)) parentsOf.set(ck, new Map());
    parentsOf.get(ck)!.set(pk, e.traceCount);
  }

  // ── Assign columns (longest-path BFS) ─────────────────────────────────
  const col = new Map<string, number>();
  const queue: string[] = [];

  // Start from nodes with no parents (entry points)
  for (const k of nodeInfo.keys()) {
    if (!parentsOf.has(k) || parentsOf.get(k)!.size === 0) {
      col.set(k, 0);
      queue.push(k);
    }
  }

  // BFS — push children to max(current, parent+1) so the graph is as deep
  // as the longest path. Re-enqueue when depth increases so descendants
  // update too.
  let head = 0;
  while (head < queue.length) {
    const key = queue[head++];
    const c = col.get(key)!;
    for (const [ck] of childrenOf.get(key) ?? []) {
      const prev = col.get(ck);
      if (prev === undefined || prev < c + 1) {
        col.set(ck, c + 1);
        queue.push(ck); // re-enqueue to propagate
      }
    }
  }

  // Orphan safety
  for (const k of nodeInfo.keys()) {
    if (!col.has(k)) col.set(k, 0);
  }

  // ── Group by column ────────────────────────────────────────────────────
  const remapped = new Map<number, string[]>();
  for (const [k, c] of col) {
    if (!remapped.has(c)) remapped.set(c, []);
    remapped.get(c)!.push(k);
  }

  // ── Barycenter ordering (reduce edge crossings) ────────────────────────
  // Initial order: sort by total trace count (most frequent at top)
  for (const keys of remapped.values()) {
    keys.sort((a, b) => {
      const aCount =
        [...(childrenOf.get(a)?.values() ?? [])].reduce((s, v) => s + v, 0) +
        [...(parentsOf.get(a)?.values() ?? [])].reduce((s, v) => s + v, 0);
      const bCount =
        [...(childrenOf.get(b)?.values() ?? [])].reduce((s, v) => s + v, 0) +
        [...(parentsOf.get(b)?.values() ?? [])].reduce((s, v) => s + v, 0);
      return bCount - aCount;
    });
  }

  // Assign initial row indices
  const rowIdx = new Map<string, number>();
  for (const [, keys] of remapped) {
    keys.forEach((k, i) => rowIdx.set(k, i));
  }

  // Barycenter passes: use neighbours' positions to reorder
  const maxCol = Math.max(...remapped.keys(), 0);
  for (let pass = 0; pass < 4; pass++) {
    // Forward sweep (left to right)
    for (let c = 1; c <= maxCol; c++) {
      const keys = remapped.get(c);
      if (!keys) continue;
      const bary = new Map<string, number>();
      for (const k of keys) {
        const parents = parentsOf.get(k);
        if (!parents || parents.size === 0) {
          bary.set(k, rowIdx.get(k) ?? 0);
          continue;
        }
        let sum = 0,
          weight = 0;
        for (const [pk, cnt] of parents) {
          const r = rowIdx.get(pk);
          if (r !== undefined) {
            sum += r * cnt;
            weight += cnt;
          }
        }
        bary.set(k, weight > 0 ? sum / weight : (rowIdx.get(k) ?? 0));
      }
      keys.sort((a, b) => (bary.get(a) ?? 0) - (bary.get(b) ?? 0));
      keys.forEach((k, i) => rowIdx.set(k, i));
    }
    // Backward sweep (right to left)
    for (let c = maxCol - 1; c >= 0; c--) {
      const keys = remapped.get(c);
      if (!keys) continue;
      const bary = new Map<string, number>();
      for (const k of keys) {
        const children = childrenOf.get(k);
        if (!children || children.size === 0) {
          bary.set(k, rowIdx.get(k) ?? 0);
          continue;
        }
        let sum = 0,
          weight = 0;
        for (const [ck, cnt] of children) {
          const r = rowIdx.get(ck);
          if (r !== undefined) {
            sum += r * cnt;
            weight += cnt;
          }
        }
        bary.set(k, weight > 0 ? sum / weight : (rowIdx.get(k) ?? 0));
      }
      keys.sort((a, b) => (bary.get(a) ?? 0) - (bary.get(b) ?? 0));
      keys.forEach((k, i) => rowIdx.set(k, i));
    }
  }

  // ── Compute positions ──────────────────────────────────────────────────
  const positions = new Map<string, { x: number; y: number }>();
  for (const [c, keys] of remapped) {
    const totalH = keys.length * NODE_H + (keys.length - 1) * GAP_Y;
    const startY = -totalH / 2;
    keys.forEach((k, i) => {
      positions.set(k, {
        x: c * (NODE_W + GAP_X),
        y: startY + i * (NODE_H + GAP_Y),
      });
    });
  }

  // ── Build React Flow nodes ─────────────────────────────────────────────
  const rfNodes: Node[] = [];
  for (const [key, info] of nodeInfo) {
    const pos = positions.get(key);
    if (!pos) continue;
    rfNodes.push({
      id: key,
      type: "default",
      position: { x: pos.x, y: pos.y },
      data: { label: info.name },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      className: `${classForType(info.type)} !rounded-md !text-xs !font-medium !shadow-none`,
    });
  }

  // Normalize so top-left is (0, 0)
  if (rfNodes.length) {
    const minX = Math.min(...rfNodes.map((n) => n.position.x));
    const minY = Math.min(...rfNodes.map((n) => n.position.y));
    for (const n of rfNodes) {
      n.position.x -= minX;
      n.position.y -= minY;
    }
  }

  // ── Build React Flow edges ─────────────────────────────────────────────
  const maxCount = Math.max(...rawEdges.map((e) => e.traceCount), 1);
  const rfEdges: Edge[] = [];

  for (const e of rawEdges) {
    const pk = nk(e.parentName, e.parentType);
    const ck = nk(e.childName, e.childType);

    // Skip if either node isn't rendered
    if (!positions.has(pk) || !positions.has(ck)) continue;

    const ratio = e.traceCount / totalTraces;
    const opacity = 0.15 + 0.85 * (e.traceCount / maxCount);
    const freq = `${e.traceCount}/${totalTraces}`;

    rfEdges.push({
      id: `${pk}→${ck}`,
      source: pk,
      target: ck,
      label: ratio >= 0.1 ? freq : undefined, // only label edges >=10%
      labelStyle: { fill: "var(--color-zinc-500)", fontSize: 10 },
      labelBgStyle: { fill: "var(--color-zinc-950)", fillOpacity: 0.9 },
      labelBgPadding: [4, 2] as [number, number],
      style: { opacity, strokeWidth: ratio >= 0.5 ? 2 : 1 },
      className: "[&>path]:!stroke-zinc-600",
    });
  }

  return { nodes: rfNodes, edges: rfEdges };
}

export function TraceFlowGraph({
  edges,
  totalTraces,
  isLoading,
}: TraceFlowGraphProps) {
  const { nodes, edges: rfEdges } = useMemo(
    () => layoutGraph(edges, totalTraces),
    [edges, totalTraces],
  );

  if (isLoading) {
    return (
      <div
        className="border border-zinc-800 rounded-lg overflow-hidden flex items-center justify-center"
        style={{ height: 400 }}
      >
        <SpinnerGap size={20} className="text-zinc-600 animate-spin" />
      </div>
    );
  }

  if (!edges.length) {
    return (
      <div
        className="border border-dashed border-zinc-700 rounded-lg overflow-hidden flex flex-col items-center justify-center"
        style={{ height: 200 }}
      >
        <Pulse size={24} className="text-zinc-600 mb-2" />
        <p className="text-xs text-zinc-500">No execution flow data</p>
      </div>
    );
  }

  return (
    <div
      className="border border-zinc-800 rounded-lg overflow-hidden"
      style={{ height: 400 }}
    >
      <ReactFlow
        nodes={nodes}
        edges={rfEdges}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag
        zoomOnScroll={false}
        minZoom={0.3}
        maxZoom={1.5}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          className="!bg-zinc-950"
          style={{ color: "var(--color-zinc-800)" }}
        />
      </ReactFlow>
    </div>
  );
}
