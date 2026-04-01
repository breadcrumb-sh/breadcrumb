/**
 * Fade-out overlay for truncated content.
 * Inherits --fade-color from the nearest parent, defaulting to zinc-950.
 */
export function FadeOverlay({
  height = 48,
  className = "",
}: {
  height?: number;
  className?: string;
}) {
  return (
    <div
      className={`pointer-events-none absolute bottom-0 left-0 right-0 ${className}`}
      style={{
        height,
        background: `linear-gradient(to bottom, transparent, var(--fade-color, var(--color-zinc-950)))`,
      }}
    />
  );
}
