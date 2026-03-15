import { CaretDown } from "@phosphor-icons/react/CaretDown";
import { CaretRight } from "@phosphor-icons/react/CaretRight";
import { useState } from "react";
import {
  typeClass,
  formatCost,
  type SpanData,
  type SpanNode,
} from "../../lib/span-utils";
import { fmtMs, spanDurationMs } from "./helpers";

export function SpanRow({
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
        {node.type !== "custom" && (
          <span
            className={`shrink-0 inline-flex items-center rounded border px-1.5 py-[2px] text-[10px] font-medium leading-none ${typeClass(node.type)}`}
          >
            {node.type}
          </span>
        )}

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
