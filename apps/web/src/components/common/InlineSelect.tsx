import { CaretDown } from "@phosphor-icons/react/CaretDown";

type Option<T extends string> = { value: T; label: string };

export function InlineSelect<T extends string>({
  value,
  onChange,
  options,
  size = "sm",
}: {
  value: T;
  onChange: (value: T) => void;
  options: Option<T>[];
  size?: "sm" | "xs";
}) {
  const sizeClasses =
    size === "xs"
      ? "h-[20px] text-[10px] pl-1.5 pr-4 gap-0.5"
      : "h-[26px] text-[11px] pl-2 pr-5 gap-1";

  const caretSize = size === "xs" ? 8 : 10;
  const caretRight = size === "xs" ? "right-1" : "right-1.5";

  return (
    <span className="relative inline-flex items-center">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className={`appearance-none bg-transparent text-zinc-400 outline-none cursor-pointer hover:text-zinc-200 focus:text-zinc-200 transition-colors ${sizeClasses}`}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <CaretDown
        size={caretSize}
        weight="bold"
        className={`pointer-events-none absolute ${caretRight} text-zinc-500`}
      />
    </span>
  );
}
