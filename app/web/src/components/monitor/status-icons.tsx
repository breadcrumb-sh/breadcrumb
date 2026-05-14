function pieSlice(cx: number, cy: number, r: number, fraction: number): string {
  if (fraction >= 1)
    return `M${cx},${cy} m-${r},0 a${r},${r} 0 1,1 ${r * 2},0 a${r},${r} 0 1,1 -${r * 2},0`;
  const angle = fraction * 2 * Math.PI - Math.PI / 2;
  const x = cx + r * Math.cos(angle);
  const y = cy + r * Math.sin(angle);
  const large = fraction > 0.5 ? 1 : 0;
  return `M${cx},${cy} L${cx},${cy - r} A${r},${r} 0 ${large},1 ${x},${y} Z`;
}

export function QueueIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none">
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 2" />
    </svg>
  );
}

export function InvestigatingIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none">
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" />
      <path d={pieSlice(8, 8, 4, 0.25)} fill="currentColor" />
    </svg>
  );
}

export function ReviewIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none">
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" />
      <path d={pieSlice(8, 8, 4, 0.75)} fill="currentColor" />
    </svg>
  );
}

export function DoneIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none">
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" />
      <path d={pieSlice(8, 8, 4, 1)} fill="currentColor" />
    </svg>
  );
}
