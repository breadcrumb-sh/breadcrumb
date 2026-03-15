import { ChartBar } from "@phosphor-icons/react/ChartBar";
import { Check } from "@phosphor-icons/react/Check";
import { CircleNotch } from "@phosphor-icons/react/CircleNotch";
import { Code } from "@phosphor-icons/react/Code";
import { Copy } from "@phosphor-icons/react/Copy";
import { Database } from "@phosphor-icons/react/Database";
import { Star } from "@phosphor-icons/react/Star";
import { X } from "@phosphor-icons/react/X";
import { useState } from "react";
import { createPortal } from "react-dom";
import { Streamdown } from "streamdown";
import { ExplorationChart, VIZ_COLORS } from "../traces/ExplorationChart";
import { useHighlightedHtml, sdComponents } from "./StreamdownComponents";
import type { ChartSpec, DisplayPart } from "@breadcrumb/server/trpc";

// ── Chart part with SQL modal ────────────────────────────────────────────────

export function ChartPart({
  spec,
  data,
  isStarred: starred,
  onToggleStar,
}: {
  spec: ChartSpec;
  data: Record<string, unknown>[];
  isStarred: boolean;
  onToggleStar: () => void;
}) {
  const [showSql, setShowSql] = useState(false);

  return (
    <>
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
            <ChartBar size={14} className="text-zinc-500" />
            {spec.title}
          </div>
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => setShowSql(true)}
              className="p-1.5 rounded-md hover:bg-zinc-800 transition-colors"
              title="View SQL"
            >
              <Code size={14} className="text-zinc-500 hover:text-zinc-300" />
            </button>
            <button
              onClick={onToggleStar}
              className="p-1.5 rounded-md hover:bg-zinc-800 transition-colors"
              title={starred ? "Remove star" : "Star chart"}
            >
              <Star
                size={14}
                weight={starred ? "fill" : "regular"}
                className={
                  starred ? "text-amber-400" : "text-zinc-500 hover:text-zinc-300"
                }
              />
            </button>
          </div>
        </div>
        {spec.yKeys.length > 1 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {spec.yKeys.map((key, i) => {
              const label = spec.legend?.find((l) => l.key === key)?.label ?? key;
              return (
                <span
                  key={key}
                  className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-[10px] text-zinc-400"
                >
                  <span
                    className="inline-block w-2 h-2 rounded-full"
                    style={{ backgroundColor: VIZ_COLORS[i % VIZ_COLORS.length] }}
                  />
                  {label}
                </span>
              );
            })}
          </div>
        )}
        {data.length > 0 ? (
          <ExplorationChart
            chartType={spec.chartType}
            xKey={spec.xKey}
            yKeys={spec.yKeys}
            legend={spec.legend}
            data={data}
          />
        ) : (
          <div className="flex items-center justify-center rounded-md border border-dashed border-zinc-700 bg-zinc-900/50 py-12">
            <p className="text-xs text-zinc-500">No data returned by query</p>
          </div>
        )}
      </div>

      {showSql && <SqlModal sql={spec.sql} onClose={() => setShowSql(false)} />}
    </>
  );
}

export function SqlModal({ sql, onClose }: { sql: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const html = useHighlightedHtml(sql.trim(), "sql");

  const copy = () => {
    navigator.clipboard.writeText(sql);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl mx-4 border border-zinc-800 bg-zinc-900 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-2.5 bg-zinc-800/60 border-b border-zinc-800">
          <span className="text-[11px] font-medium text-zinc-400 uppercase tracking-wide">
            SQL
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={copy}
              className="flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              onClick={onClose}
              className="p-0.5 text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              <X size={14} />
            </button>
          </div>
        </div>
        {html ? (
          <div
            className="overflow-x-auto px-4 py-4 text-[13px] leading-relaxed [&_pre]:!bg-transparent [&_code]:!bg-transparent"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <pre className="overflow-x-auto px-4 py-4 text-[13px] font-mono text-zinc-300 leading-relaxed">
            <code>{sql.trim()}</code>
          </pre>
        )}
      </div>
    </div>,
    document.body,
  );
}

// ── Part renderer ──────────────────────────────────────────────────────────────

export function PartRenderer({
  part,
  isLast,
  streaming,
  isStarred,
  onToggleStar,
  plugins,
}: {
  part: DisplayPart;
  isLast: boolean;
  streaming: boolean;
  isStarred: (sql: string) => boolean;
  onToggleStar: (spec: ChartSpec) => void;
  plugins: Record<string, unknown>;
}) {
  switch (part.type) {
    case "user":
      return (
        <div className="flex justify-end">
          <div className="max-w-[80%] rounded-2xl rounded-br-md bg-zinc-700/50 px-4 py-2.5 text-sm text-zinc-100 whitespace-pre-wrap">
            {part.content}
          </div>
        </div>
      );

    case "text":
      return (
        <div className="text-sm text-zinc-300 [&_h1]:text-zinc-100 [&_h2]:text-zinc-100 [&_h3]:text-zinc-100 [&_h4]:text-zinc-100 [&_strong]:text-zinc-200">
          <Streamdown
            mode={isLast && streaming ? "streaming" : "static"}
            plugins={plugins}
            components={sdComponents}
          >
            {part.content}
          </Streamdown>
        </div>
      );

    case "chart":
      return (
        <ChartPart
          spec={part.spec}
          data={part.data}
          isStarred={isStarred(part.spec.sql)}
          onToggleStar={() => onToggleStar(part.spec)}
        />
      );

    case "tool-loading":
      return (
        <div className="flex items-center gap-2 text-xs text-zinc-500 py-2">
          <CircleNotch size={12} className="animate-spin" />
          <Database size={12} />
          {part.toolName === "display_chart"
            ? "Generating chart..."
            : "Running query..."}
        </div>
      );
  }
}
