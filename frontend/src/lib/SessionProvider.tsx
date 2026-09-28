"use client";

import { Session } from "@supabase/supabase-js";
import { createContext, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export interface SessionState {
  session: Session | null;
  loading: boolean;
}

export const SessionContext = createContext<SessionState | null>(null);

// The most recently resolved access token, kept in sync by SessionProvider's
// single onAuthStateChange subscription below -- lets authFetch (lib/api.ts)
// use the already-resolved session instead of independently awaiting
// supabase.auth.getSession() (a redundant read, not a "faster" one -- it's
// the same underlying client state) on every single API call. Module-scoped,
// so it lives per browser tab/JS realm exactly like the `supabase` client
// itself already does -- never shared across tabs. It is updated by the very
// same listener that updates `session` state below, on every SIGNED_IN,
// SIGNED_OUT, TOKEN_REFRESHED, and USER_UPDATED event, so it can never serve
// a stale token after a refresh, or a previous user's token after a
// logout/login switch in the same tab.
let currentAccessToken: string | null = null;

/** Read-only access to the token above -- see the comment there. Not a
 * hook: callers outside React (lib/api.ts's authFetch) can call this
 * directly, since SessionProvider keeps it current independent of whether
 * anything is currently reading `session` via context. */
export function getAccessToken(): string | null {
  return currentAccessToken;
}

/** Resolves the Supabase session exactly once for the whole app, instead of
 * every page independently calling getSession()/subscribing to auth-state
 * changes -- previously each of the ~9 pages that needed the session did
 * both, which is what let the app shell (sidebar/bottom nav) render before
 * any page had resolved its own session state: the shell didn't know about
 * loading at all, so it never waited. Hoisting this to one provider lets
 * AppShell gate on the *same* loading flag every page already reads via
 * useSession(), so the shell chrome and page content resolve together. */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      currentAccessToken = data.session?.access_token ?? null;
      setSession(data.session);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      currentAccessToken = newSession?.access_token ?? null;
      setSession(newSession);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  return <SessionContext.Provider value={{ session, loading }}>{children}</SessionContext.Provider>;
}
