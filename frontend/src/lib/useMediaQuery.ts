"use client";

import { useSyncExternalStore } from "react";

/** Live match state for a CSS media query. The server snapshot is `false`
 * (mobile-first), so server and first client render agree; the real value
 * arrives right after hydration. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
