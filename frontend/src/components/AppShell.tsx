"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { AppSidebar } from "@/components/AppSidebar";
import { BootstrapLoader } from "@/components/BootstrapLoader";
import { BottomNav } from "@/components/BottomNav";
import { NotificationPoller } from "@/components/NotificationPoller";
import { SHELL_HIDDEN_ROUTES } from "@/lib/navItems";
import { useSession } from "@/lib/useSession";

const COLLAPSE_STORAGE_KEY = "macromate-sidebar-collapsed";

/**
 * The one authenticated application shell — a persistent sidebar plus the
 * page content, shared by every screen via the root layout rather than
 * copy-pasted per page (Today, Progress, Coach, Friends, Profile all
 * render through this same wrapper). Pre-auth/onboarding routes render
 * their children directly, with no shell chrome at all, exactly like the
 * BottomNav/SettingsDrawer it replaces used to gate themselves.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { session, loading: sessionLoading } = useSession();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(COLLAPSE_STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reads a synchronous local API, not fetched data
      if (stored === "1") setCollapsed(true);
    } catch {
      // Private-browsing / storage-blocked — falls back to expanded.
    }
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSE_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // Preference just won't persist across reloads.
      }
      return next;
    });
  }

  if (!pathname || SHELL_HIDDEN_ROUTES.has(pathname)) {
    return <>{children}</>;
  }

  // Every shell route's own page component re-derives this same loading
  // flag (via useSession, now backed by the same shared resolution -- see
  // SessionProvider) and shows its own "Loading…" text -- but until now the
  // sidebar/bottom nav rendered instantly regardless, so that per-page text
  // appeared nested inside fully-interactive authenticated chrome before
  // the app even knew whether there *was* a session. Gating here means the
  // shell and the page content resolve together, with one loader instead
  // of a chrome flash followed by a second, plainer one.
  if (sessionLoading) {
    return <BootstrapLoader />;
  }

  return (
    <div className="flex min-h-full flex-1">
      {session && <NotificationPoller />}
      <AppSidebar collapsed={collapsed} onToggleCollapsed={toggleCollapsed} />
      <div
        className={`flex min-h-full flex-1 flex-col transition-[padding] duration-150 ${
          collapsed ? "lg:pl-16" : "lg:pl-64"
        }`}
      >
        {/* The mobile menu trigger (AppSidebar) floats as position:fixed at
            top-4 left-4 (a 40px circle, bottom edge at 56px) so it never
            reserves space in normal flow -- without this clearance, any
            page whose own heading starts flush at the top-left (every page
            here does) has its first ~56px of text/icons visually covered
            by that button on any viewport narrower than the lg breakpoint.
            pt-16 clears it with a little breathing room; lg:pt-0 removes
            it entirely once the floating button itself is hidden. */}
        <div className="flex flex-1 flex-col pt-16 lg:pt-0">{children}</div>
        <BottomNav />
      </div>
    </div>
  );
}
