"use client";

import { useEffect, useState } from "react";
import {
  NotificationSettings,
  fetchNotificationSettings,
  updateNotificationSettings,
} from "@/lib/api";

type PermissionState = "default" | "granted" | "denied" | "unsupported";

function readNotificationPermission(): PermissionState {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

/** View/edit the user's real notification preferences — the single
 * implementation shared by the standalone Profile page and the app
 * sidebar's "Notifications" section. Only exposes settings the backend
 * actually supports (logging reminders + a time, streak warnings, macro
 * nudges, friend meal activity, quiet hours) plus the one thing that's
 * genuinely real without any push-delivery infrastructure: requesting
 * browser notification permission so NotificationPoller (see that file)
 * can show a real OS-level notification while the app is open, in addition
 * to its in-app banner. There is no remote/push delivery to pretend is
 * active here — see app/core/fcm.py on the backend for exactly what that
 * would require. */
export function NotificationsManager() {
  const [notif, setNotif] = useState<NotificationSettings | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permission, setPermission] = useState<PermissionState>("default");

  useEffect(() => {
    fetchNotificationSettings()
      .then(setNotif)
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load preferences."));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads a client-only browser API, not reachable during render
    setPermission(readNotificationPermission());
  }, []);

  async function handleSave() {
    if (!notif) return;
    setError(null);
    setSaved(false);
    try {
      await updateNotificationSettings(notif);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save preferences.");
    }
  }

  async function handleRequestPermission() {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    const result = await Notification.requestPermission();
    setPermission(result);
  }

  if (!notif) {
    return <p className="text-xs text-on-surface-variant">Loading…</p>;
  }

  return (
    <div className="space-y-1">
      <label className="flex items-center justify-between py-1 text-sm font-semibold text-on-surface">
        All notifications
        <input
          type="checkbox"
          checked={notif.notifications_enabled}
          onChange={(e) => {
            setSaved(false);
            setNotif({ ...notif, notifications_enabled: e.target.checked });
          }}
        />
      </label>

      <div className={notif.notifications_enabled ? "" : "pointer-events-none opacity-50"}>
        <label className="flex items-center justify-between py-1 text-sm text-on-surface">
          Logging reminder
          <input
            type="checkbox"
            checked={notif.logging_reminders_enabled}
            onChange={(e) => {
              setSaved(false);
              setNotif({ ...notif, logging_reminders_enabled: e.target.checked });
            }}
          />
        </label>
        {notif.logging_reminders_enabled && (
          <label className="flex items-center justify-between py-1 pl-3 text-xs text-on-surface-variant">
            Remind me at
            <input
              type="time"
              value={notif.reminder_times[0] ?? ""}
              onChange={(e) => {
                setSaved(false);
                setNotif({
                  ...notif,
                  reminder_times: e.target.value ? [`${e.target.value}:00`] : [],
                });
              }}
              className="input"
            />
          </label>
        )}
        <label className="flex items-center justify-between py-1 text-sm text-on-surface">
          Streak-at-risk warnings
          <input
            type="checkbox"
            checked={notif.streak_warnings_enabled}
            onChange={(e) => {
              setSaved(false);
              setNotif({ ...notif, streak_warnings_enabled: e.target.checked });
            }}
          />
        </label>
        <label className="flex items-center justify-between py-1 text-sm text-on-surface">
          Macro-close-to-goal nudges
          <input
            type="checkbox"
            checked={notif.macro_nudges_enabled}
            onChange={(e) => {
              setSaved(false);
              setNotif({ ...notif, macro_nudges_enabled: e.target.checked });
            }}
          />
        </label>
        <label className="flex items-center justify-between py-1 text-sm text-on-surface">
          Friend meal activity
          <input
            type="checkbox"
            checked={notif.friend_activity_enabled}
            onChange={(e) => {
              setSaved(false);
              setNotif({ ...notif, friend_activity_enabled: e.target.checked });
            }}
          />
        </label>
        <div className="mt-2 flex items-center gap-2">
          <label className="flex flex-col gap-1 text-xs text-on-surface-variant">
            Quiet hours start
            <input
              type="time"
              value={notif.quiet_hours_start ?? ""}
              onChange={(e) => {
                setSaved(false);
                setNotif({ ...notif, quiet_hours_start: e.target.value || null });
              }}
              className="input"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-on-surface-variant">
            End
            <input
              type="time"
              value={notif.quiet_hours_end ?? ""}
              onChange={(e) => {
                setSaved(false);
                setNotif({ ...notif, quiet_hours_end: e.target.value || null });
              }}
              className="input"
            />
          </label>
        </div>
      </div>

      <button
        type="button"
        onClick={handleSave}
        className="mt-3 w-full rounded-[var(--radius-control)] bg-primary py-2 text-sm font-semibold text-on-primary"
      >
        Save notification preferences
      </button>
      {saved && <p className="text-xs text-primary">Notification preferences saved.</p>}
      {error && <p className="text-xs text-fat">{error}</p>}

      {permission !== "unsupported" && (
        <div className="mt-3 border-t border-outline-variant pt-3">
          {permission === "granted" && (
            <p className="text-xs text-on-surface-variant">
              Browser notifications are allowed on this device.
            </p>
          )}
          {permission === "denied" && (
            <p className="text-xs text-on-surface-variant">
              Browser notifications are blocked in this browser — enable them in your browser&apos;s
              site settings to see them outside the app.
            </p>
          )}
          {permission === "default" && (
            <button
              type="button"
              onClick={handleRequestPermission}
              className="w-full rounded-[var(--radius-control)] border border-outline-variant py-2 text-sm font-semibold text-on-surface"
            >
              Enable browser notifications
            </button>
          )}
        </div>
      )}
    </div>
  );
}
