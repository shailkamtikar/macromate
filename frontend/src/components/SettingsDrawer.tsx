"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import ProfilePage from "@/app/profile/page";

// Same routes BottomNav hides on — there's no profile/settings to open
// before a session or profile exists yet.
const HIDDEN_ON = new Set(["/login", "/signup", "/onboarding", "/"]);

/**
 * App-level profile/settings access, available from every major screen —
 * a persistent trigger that opens a retractable panel (a right-side
 * sidebar on wide viewports, a full-width slide-in drawer on narrow ones)
 * over whatever page is currently showing. The panel embeds the real
 * Profile page component directly rather than re-implementing its
 * settings, so there's exactly one settings implementation, reused here
 * and at the standalone /profile route — including its own Logout button,
 * which stays the last thing in the panel.
 */
export function SettingsDrawer() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // Close on route change (e.g. logging out from inside the panel
    // navigates to /login) — not a render-driven prop sync, so this is a
    // deliberate exception to the no-setState-in-effect rule.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate reset on navigation, not data-fetch sync
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  if (!pathname || HIDDEN_ON.has(pathname)) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Profile & settings"
        className="fixed right-4 top-4 z-30 flex h-10 w-10 items-center justify-center rounded-full border border-outline-variant bg-surface-container-lowest text-on-surface-variant shadow-md"
      >
        <span className="material-symbols-outlined text-xl">person</span>
      </button>

      <div
        className={`fixed inset-0 z-40 ${open ? "" : "pointer-events-none"}`}
        aria-hidden={!open}
      >
        <div
          onClick={() => setOpen(false)}
          className={`absolute inset-0 bg-black/40 transition-opacity ${
            open ? "opacity-100" : "opacity-0"
          }`}
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Profile & settings"
          className={`absolute right-0 top-0 flex h-full w-full max-w-sm flex-col overflow-y-auto bg-surface shadow-xl transition-transform duration-200 sm:max-w-md ${
            open ? "translate-x-0" : "translate-x-full"
          }`}
        >
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-outline-variant bg-surface px-4 py-3">
            <span className="text-sm font-semibold text-on-surface">Profile &amp; settings</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close profile & settings"
              className="flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant"
            >
              <span className="material-symbols-outlined text-lg">close</span>
            </button>
          </div>
          <div className="flex-1">{open && <ProfilePage />}</div>
        </div>
      </div>
    </>
  );
}
