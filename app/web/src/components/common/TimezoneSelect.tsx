import { useMemo, useState } from "react";

function getAllTimezones(): string[] {
  return (Intl as unknown as { supportedValuesOf(key: string): string[] })
    .supportedValuesOf("timeZone");
}

function formatTzLabel(tz: string): string {
  try {
    const now = new Date();
    const offset = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "shortOffset",
    })
      .formatToParts(now)
      .find((p) => p.type === "timeZoneName")?.value ?? "";
    return `${tz.replace(/_/g, " ")} (${offset})`;
  } catch {
    return tz;
  }
}

export function TimezoneSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (tz: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);

  const allTimezones = useMemo(() => getAllTimezones(), []);
  const filtered = useMemo(() => {
    if (!search) return allTimezones;
    const q = search.toLowerCase();
    return allTimezones.filter((tz) => tz.toLowerCase().includes(q));
  }, [search, allTimezones]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-left text-sm text-zinc-100 outline-none focus:border-zinc-500"
      >
        {formatTzLabel(value)}
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-zinc-700 bg-zinc-900 shadow-lg">
          <div className="p-2">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search timezones..."
              autoFocus
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-zinc-500"
            />
          </div>
          <ul className="max-h-60 overflow-y-auto py-1">
            {filtered.map((tz) => (
              <li key={tz}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(tz);
                    setOpen(false);
                    setSearch("");
                  }}
                  className={`w-full px-3 py-1.5 text-left text-sm hover:bg-zinc-800 ${
                    tz === value ? "text-white bg-zinc-800" : "text-zinc-300"
                  }`}
                >
                  {formatTzLabel(tz)}
                </button>
              </li>
            ))}
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-sm text-zinc-500">No timezones found</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
