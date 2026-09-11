/** The one loading screen shown during genuine app bootstrap: initial
 * Supabase session resolution and the brief window before the shell
 * chrome/route content is known to be safe to render. Deliberately calm —
 * a static wordmark with a slow breathing-opacity pulse, no spinner, no
 * gradient/glow, no motion beyond what prefers-reduced-motion allows.
 * Full-viewport and using the same surface tokens as the rest of the app
 * so light/dark mode and standalone PWA launches never show a mismatched
 * background. */
export function BootstrapLoader() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-dvh flex-1 items-center justify-center bg-surface"
    >
      <div aria-hidden="true" className="bootstrap-breathe font-display text-2xl font-bold tracking-tight text-on-surface">
        MacroMate
      </div>
      <span className="sr-only">Loading MacroMate…</span>
    </div>
  );
}
