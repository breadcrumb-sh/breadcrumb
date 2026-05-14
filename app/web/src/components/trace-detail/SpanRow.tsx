import { CaretDown } from "@phosphor-icons/react/CaretDown";
import { CaretRight } from "@phosphor-icons/react/CaretRight";
import { useEffect, useState } from "react";
import {
  formatCost,
  type SpanData,
  type SpanNode,
} from "../../lib/span-utils";
import { fmtMs, spanDurationMs } from "./helpers";

const TYPE_TEXT_COLOR: Record<string, string> = {
  llm: "text-purple-400/70",
  tool: "text-blue-400/70",
  retrieval: "text-emerald-400/70",
};

export function SpanRow({
  node,
  depth,
  selectedId,
  onSelect,
  forceExpandIds,
}: {
  node: SpanNode;
  depth: number;
  selectedId: string | null;
  onSelect: (span: SpanData) => void;
  forceExpandIds?: Set<string>;
}) {
  const [open, setOpen] = useState(true);
  const hasChildren = node.children.length > 0;
  const isSelected = node.id === selectedId;
  const dur = fmtMs(spanDurationMs(node.startTime, node.endTime));
  const totalTokens = node.inputTokens + node.outputTokens;
  const totalCost = node.inputCostUsd + node.outputCostUsd;

  // Force-expand when this node is in the ancestor path of a linked span
  useEffect(() => {
    if (forceExpandIds?.has(node.id) && !open) {
      setOpen(true);
    }
  }, [forceExpandIds, node.id]);

  return (
    <>
      <div
        data-span-id={node.id}
        className={`flex items-center gap-1.5 py-2 pr-4 cursor-pointer transition-colors ${
          isSelected ? "bg-zinc-800/80" : "hover:bg-zinc-900/60"
        }`}
        style={{ paddingLeft: `${8 + depth * 12}px` }}
        onClick={() => onSelect(node)}
      >
        {/* Expand toggle */}
        <button
          className="shrink-0 w-3.5 flex items-center justify-center text-zinc-500 hover:text-zinc-400"
          onClick={(e) => {
            e.stopPropagation();
            setOpen((o) => !o);
          }}
        >
          {hasChildren ? (
            open ? (
              <CaretDown size={9} />
            ) : (
              <CaretRight size={9} />
            )
          ) : null}
        </button>

        {/* Status dot — only shown on error */}
        {node.status === "error" && (
          <span className="shrink-0 size-1.5 rounded-full bg-red-500" />
        )}

        {/* Name */}
        <span className="text-xs text-zinc-100 font-medium truncate flex-1 min-w-0">
          {node.name}
        </span>

        {/* Duration */}
        <span className="shrink-0 text-[11px] text-zinc-500 tabular-nums w-12 text-right">
          {dur}
        </span>

        {/* Tokens */}
        <span className="shrink-0 text-[11px] text-zinc-500 tabular-nums w-14 text-right">
          {totalTokens > 0 ? `${totalTokens.toLocaleString()}t` : ""}
        </span>

        {/* Cost */}
        <span className="shrink-0 text-[11px] text-zinc-500 tabular-nums w-16 text-right">
          {totalCost > 0 ? formatCost(totalCost) : ""}
        </span>

        {/* Type indicator */}
        <span className={`shrink-0 text-[11px] font-medium w-10 text-right ${node.type !== "custom" ? (TYPE_TEXT_COLOR[node.type] ?? "text-zinc-400/70") : ""}`}>
          {node.type !== "custom" ? node.type : ""}
        </span>
      </div>

      {open &&
        node.children.map((child) => (
          <SpanRow
            key={child.id}
            node={child}
            depth={depth + 1}
            selectedId={selectedId}
            onSelect={onSelect}
            forceExpandIds={forceExpandIds}
          />
        ))}
    </>
  );
}
