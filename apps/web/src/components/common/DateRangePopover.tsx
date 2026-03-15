import { useState, useEffect, useRef, useCallback } from "react";
import { CalendarBlank } from "@phosphor-icons/react/CalendarBlank";
import { CaretDown } from "@phosphor-icons/react/CaretDown";
import { useClickOutside } from "../../hooks/useClickOutside";

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function presetFrom(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days + 1);
  return d.toISOString().slice(0, 10);
}

function fmtDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function DateRangePopover({
  from,
  to,
  preset,
  onPreset,
  onCustom,
  onFromChange,
  onToChange,
}: {
  from: string;
  to: string;
  preset: 7 | 30 | 90 | null;
  onPreset: (d: 7 | 30 | 90) => void;
  onCustom: () => void;
  onFromChange: (v: string) => void;
  onToChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [showCustom, setShowCustom] = useState(preset === null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) setShowCustom(preset === null);
  }, [open]);

  const closePopover = useCallback(() => setOpen(false), []);
  useClickOutside(ref, closePopover);

  const label = preset ? `Last ${preset} days` : `${fmtDate(from)} – ${fmtDate(to)}`;

  const inputCls =
    "flex-1 h-7 rounded px-2 text-xs bg-zinc-950 border border-zinc-800 text-zinc-300 outline-none focus:border-zinc-600 [color-scheme:dark]";

  const tabCls = (active: boolean) =>
    `px-2.5 py-1.5 rounded text-xs font-medium transition-colors ${
      active ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
    }`;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`h-[30px] flex items-center gap-2 rounded-md border px-2.5 text-xs outline-none transition-colors ${
          open
            ? "border-zinc-600 bg-zinc-900 text-zinc-300"
            : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700"
        }`}
      >
        <CalendarBlank size={12} className="shrink-0 text-zinc-500" />
        <span>{label}</span>
        <CaretDown
          size={10}
          className={`shrink-0 text-zinc-600 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="absolute top-[calc(100%+4px)] left-0 z-50 w-56 rounded-md border border-zinc-800 bg-zinc-900 shadow-xl p-3 space-y-3">
          <div className="flex items-center bg-zinc-950 border border-zinc-800 rounded-md p-0.5 gap-0.5">
            {([7, 30, 90] as const).map((d) => (
              <button
                key={d}
                onClick={() => { setShowCustom(false); onPreset(d); setOpen(false); }}
                className={tabCls(preset === d && !showCustom)}
              >
                {d}d
              </button>
            ))}
            <button
              onClick={() => { setShowCustom(true); onCustom(); }}
              className={tabCls(showCustom)}
            >
              Custom
            </button>
          </div>

          {showCustom && (
            <>
              <div className="h-px bg-zinc-800" />
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-zinc-500 w-7 shrink-0">From</span>
                  <input
                    type="date"
                    value={from}
                    max={to}
                    onChange={(e) => onFromChange(e.target.value)}
                    className={inputCls}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-zinc-500 w-7 shrink-0">To</span>
                  <input
                    type="date"
                    value={to}
                    min={from}
                    max={today()}
                    onChange={(e) => onToChange(e.target.value)}
                    className={inputCls}
                  />
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
