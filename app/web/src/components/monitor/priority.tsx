export function PriorityIcon({ level, className = "" }: { level: string; className?: string }) {
  if (level === "critical") {
    return (
      <svg viewBox="0 0 16 16" className={`size-4 ${className}`} fill="none">
        <rect x="2" y="2" width="12" height="12" rx="2" fill="currentColor" opacity="0.2" />
        <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <line x1="8" y1="5" x2="8" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="8" cy="11" r="0.75" fill="currentColor" />
      </svg>
    );
  }
  // Bar chart icon — bars filled based on level
  const bars = level === "high" ? 3 : level === "medium" ? 2 : level === "low" ? 1 : 0;
  return (
    <svg viewBox="0 0 16 16" className={`size-4 ${className}`} fill="none">
      <rect x="2" y="10" width="3" height="4" rx="0.5" fill="currentColor" opacity={bars >= 1 ? 1 : 0.2} />
      <rect x="6.5" y="6.5" width="3" height="7.5" rx="0.5" fill="currentColor" opacity={bars >= 2 ? 1 : 0.2} />
      <rect x="11" y="3" width="3" height="11" rx="0.5" fill="currentColor" opacity={bars >= 3 ? 1 : 0.2} />
    </svg>
  );
}

export const PRIORITIES = [
  { value: "none", label: "No priority", color: "text-zinc-500" },
  { value: "low", label: "Low", color: "text-zinc-400" },
  { value: "medium", label: "Medium", color: "text-amber-400" },
  { value: "high", label: "High", color: "text-orange-400" },
  { value: "critical", label: "Critical", color: "text-red-400" },
] as const;
