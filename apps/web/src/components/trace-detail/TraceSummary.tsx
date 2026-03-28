import { useCallback } from "react";
import { Markdown } from "../common/Markdown";

type Props = {
  markdown: string;
  onSpanClick: (spanId: string) => void;
};

export function TraceSummary({ markdown, onSpanClick }: Props) {
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement;
      const anchor = target.closest("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (href?.startsWith("#span:")) {
        e.preventDefault();
        onSpanClick(href.slice(6));
      }
    },
    [onSpanClick],
  );

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-5 py-2 border-b border-zinc-800 shrink-0 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
          Analysis
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="px-5 py-4" onClick={handleClick}>
          <Markdown>{markdown}</Markdown>
        </div>
      </div>
    </div>
  );
}
