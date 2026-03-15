import { useState, useRef, useCallback } from "react";
import { CaretDown } from "@phosphor-icons/react/CaretDown";
import { Check } from "@phosphor-icons/react/Check";
import { useClickOutside } from "../../hooks/useClickOutside";

export function MultiselectCombobox({
  options,
  selected,
  onChange,
  placeholder = "All",
}: {
  options: string[];
  selected: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);
  useClickOutside(ref, close);

  const filtered = query
    ? options.filter((n) => n.toLowerCase().includes(query.toLowerCase()))
    : options;

  const toggle = (name: string) => {
    onChange(
      selected.includes(name)
        ? selected.filter((n) => n !== name)
        : [...selected, name]
    );
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`h-[30px] flex items-center gap-1.5 rounded-md border px-2.5 text-xs outline-none transition-colors min-w-[120px] max-w-[200px] ${
          open
            ? "border-zinc-600 bg-zinc-900 text-zinc-300"
            : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700"
        }`}
      >
        <span className="truncate flex-1 text-left">
          {selected.length === 0 ? (
            <span className="text-zinc-600">{placeholder}</span>
          ) : selected.length === 1 ? (
            selected[0]
          ) : (
            `${selected.length} selected`
          )}
        </span>
        <CaretDown
          size={10}
          className={`shrink-0 text-zinc-600 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="absolute top-[calc(100%+4px)] left-0 z-50 w-64 rounded-md border border-zinc-800 bg-zinc-900 shadow-xl">
          <div className="p-1.5">
            <input
              type="text"
              placeholder="Search…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full h-7 rounded px-2.5 text-xs bg-zinc-950 border border-zinc-800 text-zinc-300 placeholder-zinc-600 outline-none focus:border-zinc-600"
              autoFocus
            />
          </div>

          <div className="max-h-52 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-zinc-600">No options found</p>
            ) : (
              filtered.map((name) => {
                const checked = selected.includes(name);
                return (
                  <button
                    key={name}
                    onClick={() => toggle(name)}
                    className="flex items-center gap-2.5 w-full px-3 py-2 text-left text-xs hover:bg-zinc-800/60 transition-colors"
                  >
                    <div
                      className={`size-3.5 rounded-sm border flex items-center justify-center shrink-0 transition-colors ${
                        checked ? "bg-zinc-400 border-zinc-400" : "border-zinc-700"
                      }`}
                    >
                      {checked && <Check size={9} weight="bold" className="text-zinc-950" />}
                    </div>
                    <span className={`truncate ${checked ? "text-zinc-200" : "text-zinc-400"}`}>
                      {name}
                    </span>
                  </button>
                );
              })
            )}
          </div>

          {selected.length > 0 && (
            <div className="border-t border-zinc-800 p-1.5">
              <button
                onClick={() => onChange([])}
                className="w-full text-xs text-zinc-500 hover:text-zinc-300 py-1 transition-colors"
              >
                Clear selection
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
