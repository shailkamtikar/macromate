"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useSession } from "@/lib/useSession";

/** App-wide server-state cache. Why: pages used to re-fetch and show a
 * loading state on every visit; with a cache, revisiting a page (or a date
 * already seen) paints instantly from memory and refreshes quietly in the
 * background. Cached data is dropped whenever the signed-in user changes so
 * one account's data can never appear in another's session. */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 10 * 60_000,
            retry: 1,
            refetchOnWindowFocus: true,
          },
        },
      }),
  );

  const { session } = useSession();
  const userId = session?.user.id ?? null;
  const previousUser = useRef<string | null>(userId);
  useEffect(() => {
    if (previousUser.current !== userId) {
      client.clear();
      previousUser.current = userId;
    }
  }, [userId, client]);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
