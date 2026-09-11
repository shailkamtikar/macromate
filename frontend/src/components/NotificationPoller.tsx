"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  FriendActivityItem,
  NotificationSettings,
  NotificationTriggerOut,
  fetchDueTriggers,
  fetchFriendActivity,
  fetchNotificationSettings,
} from "@/lib/api";
import { localDateIso } from "@/lib/date";

// Deterministic triggers (logging reminder / streak-at-risk / macro nudge)
// change slowly across a day -- 5 minutes is frequent enough to feel timely
// without polling aggressively.
const TRIGGER_POLL_MS = 5 * 60_000;
// Matches the Friends page's own existing polling cadence (see
// friends/page.tsx's ACTIVITY_REFRESH_MS) so this doesn't introduce a
// second, different refresh rate for the same data.
const FRIEND_ACTIVITY_POLL_MS = 60_000;

const SEEN_TRIGGERS_KEY = "macromate:seen-triggers";
const SEEN_ACTIVITY_KEY = "macromate:seen-friend-activity";

const MEAL_LABELS: Record<string, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "a snack",
};

interface Banner {
  id: string;
  title: string;
  body: string;
  url?: string;
}

function readSeen(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

function writeSeen(key: string, seen: Set<string>): void {
  try {
    // Bounded so this never grows without limit across a long-lived
    // browser profile -- only the most recent 200 keys are worth keeping,
    // since anything older is definitionally already stale.
    localStorage.setItem(key, JSON.stringify(Array.from(seen).slice(-200)));
  } catch {
    // Best-effort only -- worst case a notification repeats once.
  }
}

/** Polls the two genuinely-implemented notification sources -- the
 * deterministic per-user triggers (GET /api/notification-settings/check-now)
 * and friends' grouped meal activity (GET /api/friends/activity, already
 * privacy-filtered and grouped to one item per meal) -- and surfaces new
 * ones as a real browser notification (when permission is already granted)
 * plus an always-available in-app banner. This is genuinely real for
 * "while this tab is open"; it is NOT remote/push delivery (nothing fires
 * while the app is fully closed) -- see backend/app/core/fcm.py for what
 * that would require. Mounted once by AppShell for authenticated routes. */
export function NotificationPoller() {
  const [banner, setBanner] = useState<Banner | null>(null);
  const settingsRef = useRef<NotificationSettings | null>(null);
  // Both pollers are kicked off together on every mount (and, coincidentally,
  // could both need settings again around the same time later too) --
  // without memoizing the in-flight request itself, both would independently
  // call fetchNotificationSettings() since neither's plain settingsRef is
  // populated yet when the other starts, producing two real network
  // requests for the exact same data every time. This makes any concurrent
  // caller await the one shared in-flight request instead.
  const settingsPromiseRef = useRef<Promise<NotificationSettings> | null>(null);
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  const getSettings = useCallback(async (): Promise<NotificationSettings> => {
    if (settingsRef.current) return settingsRef.current;
    if (!settingsPromiseRef.current) {
      settingsPromiseRef.current = fetchNotificationSettings().finally(() => {
        settingsPromiseRef.current = null;
      });
    }
    const settings = await settingsPromiseRef.current;
    settingsRef.current = settings;
    return settings;
  }, []);

  const notify = useCallback((title: string, body: string, tag: string, url?: string) => {
    setBanner({ id: tag, title, body, url });
    if (typeof window !== "undefined" && Notification.permission === "granted" && navigator.serviceWorker?.controller) {
      navigator.serviceWorker.controller.postMessage({ type: "SHOW_NOTIFICATION", title, body, tag, url });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function pollTriggers() {
      try {
        const settings = await getSettings();
        if (cancelled || !settings.notifications_enabled) return;

        const triggers: NotificationTriggerOut[] = await fetchDueTriggers();
        if (cancelled || triggers.length === 0) return;

        const today = localDateIso(new Date());
        const seen = readSeen(SEEN_TRIGGERS_KEY);
        for (const trigger of triggers) {
          const key = `${trigger.kind}:${today}`;
          if (seen.has(key)) continue;
          seen.add(key);
          notify(trigger.title, trigger.body, key);
          // One at a time -- the in-app banner only shows the latest, and
          // multiple real triggers firing in the same poll is rare.
          break;
        }
        writeSeen(SEEN_TRIGGERS_KEY, seen);
      } catch {
        // Best-effort background polling -- a transient failure just means
        // this cycle's reminder is silently skipped, never a visible error.
      }
    }

    async function pollFriendActivity() {
      try {
        // The Friends page already polls this same endpoint itself (to
        // keep its own list live while open) -- skip this poll entirely
        // while the user is already looking at it, both to avoid a
        // redundant duplicate request every cycle and because a "new
        // friend activity" banner is pointless when that activity is
        // already visible on screen.
        if (pathnameRef.current === "/friends") return;

        const settings = await getSettings();
        if (cancelled || !settings.notifications_enabled || !settings.friend_activity_enabled) {
          return;
        }
        const items: FriendActivityItem[] = await fetchFriendActivity();
        if (cancelled || items.length === 0) return;

        const seen = readSeen(SEEN_ACTIVITY_KEY);
        for (const item of items) {
          const key = `${item.user_id}-${item.meal_type}-${item.logged_at}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const mealLabel = MEAL_LABELS[item.meal_type] ?? item.meal_type;
          notify(`${item.username} added ${mealLabel} 🍽️`, "Tap to see what's happening with friends.", key, "/friends");
          break;
        }
        writeSeen(SEEN_ACTIVITY_KEY, seen);
      } catch {
        // Same best-effort handling as pollTriggers.
      }
    }

    pollTriggers();
    pollFriendActivity();
    const triggerId = setInterval(pollTriggers, TRIGGER_POLL_MS);
    const activityId = setInterval(pollFriendActivity, FRIEND_ACTIVITY_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(triggerId);
      clearInterval(activityId);
    };
  }, [notify, getSettings]);

  useEffect(() => {
    if (!banner) return;
    const id = setTimeout(() => setBanner(null), 6000);
    return () => clearTimeout(id);
  }, [banner]);

  if (!banner) return null;

  const content = (
    <div className="reveal-in flex items-start gap-3 rounded-[var(--radius-card)] border border-outline-variant bg-surface-container-lowest p-3 shadow-sm">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-on-surface">{banner.title}</p>
        <p className="text-xs text-on-surface-variant">{banner.body}</p>
      </div>
      <button
        type="button"
        onClick={() => setBanner(null)}
        aria-label="Dismiss notification"
        className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-on-surface-variant"
      >
        <span className="material-symbols-outlined text-base" aria-hidden="true">
          close
        </span>
      </button>
    </div>
  );

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 top-3 z-50 mx-auto w-full max-w-sm px-4"
    >
      {banner.url ? (
        <a href={banner.url} className="block" data-testid="notification-banner">
          {content}
        </a>
      ) : (
        <div data-testid="notification-banner">{content}</div>
      )}
    </div>
  );
}
