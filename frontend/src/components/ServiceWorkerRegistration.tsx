"use client";

import { useEffect } from "react";

// Module-level guard: React 18/19 StrictMode intentionally double-invokes
// effects in development, which would otherwise call register() twice on
// first mount. navigator.serviceWorker.register() is itself idempotent for
// the same script+scope (the browser reuses the existing registration), so
// this isn't strictly required for correctness, but it keeps a single,
// predictable "did we already try" signal instead of relying on that
// browser-internal dedup behavior.
let registrationAttempted = false;

/** Registers the one service worker (public/sw.js) the whole app uses, for
 * PWA installability/offline shell and to let NotificationPoller show a
 * real OS-level notification via postMessage -> showNotification(). Mounted
 * once at the root layout so it's independent of auth/routing state. */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (registrationAttempted) return;
    registrationAttempted = true;

    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Best-effort: an unsupported/blocked environment (e.g. some private
      // browsing modes) just means no offline shell / local notifications,
      // never a broken app.
    });
  }, []);

  return null;
}
