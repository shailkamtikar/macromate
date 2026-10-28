/** A shimmering placeholder block. Used wherever data is still loading so
 * the page shows its final shape immediately instead of a blank screen or a
 * spinner. Purely decorative: screen readers get the surrounding region's
 * aria-busy/status text instead. The shimmer is disabled for
 * prefers-reduced-motion users (see .skeleton in globals.css). */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`skeleton rounded-[var(--radius-control)] ${className}`} />;
}
