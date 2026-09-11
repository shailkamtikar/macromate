"use client";

import { Session } from "@supabase/supabase-js";
import { createContext, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export interface SessionState {
  session: Session | null;
  loading: boolean;
}

export const SessionContext = createContext<SessionState | null>(null);

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
      setSession(data.session);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  return <SessionContext.Provider value={{ session, loading }}>{children}</SessionContext.Provider>;
}
