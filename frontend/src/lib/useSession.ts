"use client";

import { useContext } from "react";
import { SessionContext, SessionState } from "@/lib/SessionProvider";

/** Reads the app-wide session resolved once by SessionProvider (see that
 * file) -- same { session, loading } shape every existing caller already
 * expects, so no call site needs to change. */
export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error("useSession must be used within a SessionProvider");
  }
  return ctx;
}
