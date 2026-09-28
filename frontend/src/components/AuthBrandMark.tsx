/** The small MacroMate mark shown above the login/signup forms — a plain
 * monogram in the app's own primary color, matching the wordmark used in
 * the app sidebar. Deliberately not an icon-font glyph or a stock
 * "AI product" graphic; just the brand, so the auth screens read as
 * MacroMate rather than a generic auth/SaaS template. */
export function AuthBrandMark() {
  return (
    <div className="flex flex-col items-center gap-2">
      <div
        aria-hidden="true"
        className="flex h-12 w-12 items-center justify-center rounded-[var(--radius-control)] bg-primary"
      >
        <span className="font-display text-xl font-bold text-on-primary">M</span>
      </div>
      <span className="font-display text-base font-bold tracking-tight text-on-surface">
        MacroMate
      </span>
    </div>
  );
}
