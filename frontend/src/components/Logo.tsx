/** The MacroMate mark: a rounded green tile holding a macro "ring" with a gap
 * and a dot -- the same ring motif the dashboard uses for progress. */
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role="img"
      aria-label="MacroMate"
      className="flex-shrink-0"
    >
      <rect width="32" height="32" rx="9" fill="var(--color-primary)" />
      <path
        d="M16 7.5a8.5 8.5 0 1 0 8.5 8.5"
        fill="none"
        stroke="var(--color-on-primary)"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <circle cx="22.2" cy="9.8" r="2.1" fill="var(--color-on-primary)" />
    </svg>
  );
}

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <LogoMark />
      <span className="font-display text-lg font-extrabold tracking-tight text-on-surface">
        MacroMate
      </span>
    </span>
  );
}
