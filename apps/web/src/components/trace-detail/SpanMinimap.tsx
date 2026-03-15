import { useEffect, useRef, useState } from "react";
import {
  parseMs,
  type SpanData,
  type FlatSpan,
} from "../../lib/span-utils";

// ── Constants ───────────────────────────────────────────────────────────────

export const MINIMAP_COLOR: Record<string, string> = {
  llm:       "var(--minimap-llm)",
  tool:      "var(--minimap-tool)",
  retrieval: "var(--minimap-retrieval)",
  step:      "var(--minimap-step)",
};

// Minimum gap between bars as a percent of the bar area.
// At ~800px wide (768px inset) this is ~3.8px — enough to see each bar.
export const MIN_BAR_GAP = 0.5;

// ── Helpers ─────────────────────────────────────────────────────────────────

export function formatMinimapTime(ms: number): string {
  if (ms < 1000) return `+${ms}ms`;
  return `+${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)}s`;
}

export function computeBarPositions(spans: FlatSpan[], minT: number, totalMs: number) {
  // Sort by start time so the bump pass works left-to-right.
  const sorted = [...spans].sort(
    (a, b) => parseMs(a.startTime) - parseMs(b.startTime),
  );

  // Raw time-based positions (0–100).
  const raw = sorted.map(
    (s) => ((parseMs(s.startTime) - minT) / totalMs) * 100,
  );

  // Bump pass: push each bar forward if it would overlap the previous one.
  const bumped: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    bumped.push(
      i === 0 ? raw[i] : Math.max(raw[i], bumped[i - 1] + MIN_BAR_GAP),
    );
  }

  return new Map(sorted.map((s, i) => [s.id, bumped[i]]));
}

// ── Component ───────────────────────────────────────────────────────────────

export function SpanMinimap({
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

  let minT = Infinity;
  let maxT = -Infinity;
  for (const s of spans) {
    const start = parseMs(s.startTime);
    const end = parseMs(s.endTime);
    if (start < minT) minT = start;
    if (end > maxT) maxT = end;
  }
  const totalMs = maxT - minT || 1;

  const barPositions = computeBarPositions(spans, minT, totalMs);

  // Cursor: drag position while scrubbing, otherwise snap to selected span.
  const selectedPct = selectedId != null ? (barPositions.get(selectedId) ?? null) : null;
  const cursorPct = dragPct ?? selectedPct;

  function pctFromClientX(clientX: number): number {
    const rect = containerRef.current!.getBoundingClientRect();
    const insetW = rect.width - 32;
    return Math.max(0, Math.min(1, (clientX - rect.left - 16) / insetW));
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
    const pct = pctFromClientX(e.clientX);
    setDragPct(pct * 100);
    selectAt(pct);
  }

  function handleTouchStart(e: React.TouchEvent) {
    e.preventDefault();
    isDragging.current = true;
    const pct = pctFromClientX(e.touches[0].clientX);
    setDragPct(pct * 100);
    selectAt(pct);
  }

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!isDragging.current || !containerRef.current) return;
      const pct = pctFromClientX(e.clientX);
      setDragPct(pct * 100);
      selectAt(pct);
    }
    function onUp() {
      if (!isDragging.current) return;
      isDragging.current = false;
      setDragPct(null);
    }
    function onTouchMove(e: TouchEvent) {
      if (!isDragging.current || !containerRef.current) return;
      e.preventDefault();
      const pct = pctFromClientX(e.touches[0].clientX);
      setDragPct(pct * 100);
      selectAt(pct);
    }
    function onTouchEnd() {
      if (!isDragging.current) return;
      isDragging.current = false;
      setDragPct(null);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spans, minT, totalMs, onSelect]);

  return (
    <div className="px-4 sm:px-8 pb-1 shrink-0">
      <div
        ref={containerRef}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        className="relative h-11 rounded-lg border border-zinc-800 bg-zinc-900 overflow-hidden cursor-col-resize select-none touch-none"
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
