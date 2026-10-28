"use client";

import { useEffect, useState } from "react";
import { API_URL } from "@/lib/api";

/** Fire-and-forget request to the backend's /health the moment the app
 * opens, so a sleeping/restarting backend starts waking before the first
 * real data request needs it. Renders nothing. */
export function WarmPing() {
  useEffect(() => {
    fetch(`${API_URL}/health`, { cache: "no-store" }).catch(() => {});
  }, []);
  return null;
}

/** Appears only if loading is still going after a few seconds -- a calm,
 * honest explanation instead of an unexplained skeleton. */
export function SlowStartHint({ afterMs = 3000 }: { afterMs?: number }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setShow(true), afterMs);
    return () => clearTimeout(id);
  }, [afterMs]);
  if (!show) return null;
  return (
    <p role="status" data-testid="slow-start-hint" className="text-xs text-on-surface-variant">
      Waking the server… this can take a few seconds the first time.
    </p>
  );
}
