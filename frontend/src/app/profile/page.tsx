"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ActivityLevel,
  DietaryMode,
  GlassSize,
  Goal,
  NotificationSettings,
  createGlassSize,
  deleteGlassSize,
  fetchGlassSizes,
  fetchMacroTargets,
  fetchNotificationSettings,
  updateNotificationSettings,
} from "@/lib/api";
import { supabase } from "@/lib/supabaseClient";
import { Profile, useProfile } from "@/lib/useProfile";
import { useSession } from "@/lib/useSession";
import { ThemeToggle } from "@/components/ThemeToggle";

const ACTIVITY_LABELS: Record<ActivityLevel, string> = {
  sedentary: "Sedentary",
  light: "Lightly active",
  moderate: "Moderately active",
  active: "Active",
  very_active: "Very active",
};
const GOAL_LABELS: Record<Goal, string> = { cut: "Cut", maintain: "Maintain", bulk: "Bulk" };
const DIET_LABELS: Record<DietaryMode, string> = {
  vegetarian: "Vegetarian",
  egg_inclusive: "Eggetarian",
  non_vegetarian: "Non-vegetarian",
};

export default function ProfilePage() {
  const router = useRouter();
  const { session, loading: sessionLoading } = useSession();
  const profile = useProfile(session?.user.id);

  const [form, setForm] = useState<Partial<Profile>>({});
  const [weightKg, setWeightKg] = useState(75);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  const [glassSizes, setGlassSizes] = useState<GlassSize[]>([]);
  const [newGlassLabel, setNewGlassLabel] = useState("");
  const [newGlassVolume, setNewGlassVolume] = useState(250);

  const [notif, setNotif] = useState<NotificationSettings | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs local edit state when the loaded profile arrives
    if (profile) setForm(profile);
  }, [profile]);

  useEffect(() => {
    if (!session) return;
    fetchGlassSizes().then(setGlassSizes).catch(() => {});
    fetchNotificationSettings().then(setNotif).catch(() => {});
  }, [session]);

  if (sessionLoading || profile === undefined) {
    return <p className="p-10 text-sm text-on-surface-variant">Loading…</p>;
  }
  if (!session || !profile) {
    return (
      <p className="p-10 text-sm text-on-surface-variant">
        <a href="/login" className="font-semibold text-primary">
          Log in
        </a>{" "}
        first.
      </p>
    );
  }

  // Closures below are invoked asynchronously later, so TS can't narrow
  // the outer `session`/`profile` inside them even after the guard above
  // — bind non-null locals here instead.
  const currentSession = session;
  const currentProfile = profile;

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    setSaveNotice(null);
    try {
      const { targets, water_goal_ml } = await fetchMacroTargets({
        weight_kg: weightKg,
        height_cm: form.height_cm ?? currentProfile.height_cm,
        age_years: form.age_years ?? currentProfile.age_years,
        sex: (form.sex ?? currentProfile.sex) as "male" | "female",
        activity_level: (form.activity_level ?? currentProfile.activity_level) as ActivityLevel,
        goal: (form.goal ?? currentProfile.goal) as Goal,
      });

      const { error } = await supabase
        .from("profiles")
        .update({
          username: form.username ?? currentProfile.username,
          sex: form.sex ?? currentProfile.sex,
          age_years: form.age_years ?? currentProfile.age_years,
          height_cm: form.height_cm ?? currentProfile.height_cm,
          activity_level: form.activity_level ?? currentProfile.activity_level,
          goal: form.goal ?? currentProfile.goal,
          dietary_mode: form.dietary_mode ?? "non_vegetarian",
          leaderboard_visible: form.leaderboard_visible ?? currentProfile.leaderboard_visible,
          target_calories: targets.calories,
          target_protein_g: targets.protein_g,
          target_carbs_g: targets.carbs_g,
          target_fat_g: targets.fat_g,
          water_goal_ml,
        })
        .eq("id", currentSession.user.id);
      if (error) throw error;

      await supabase
        .from("weight_logs")
        .insert({ user_id: currentSession.user.id, weight_kg: weightKg });

      setSaveNotice("Saved — targets recalculated.");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  async function handleAddGlassSize() {
    if (!newGlassLabel.trim()) return;
    const created = await createGlassSize(newGlassLabel, newGlassVolume);
    setGlassSizes((prev) => [...prev, created]);
    setNewGlassLabel("");
  }

  async function handleDeleteGlassSize(id: string) {
    await deleteGlassSize(id);
    setGlassSizes((prev) => prev.filter((g) => g.id !== id));
  }

  async function handleSaveNotifications() {
    if (!notif) return;
    await updateNotificationSettings(notif);
    setSaveNotice("Notification preferences saved.");
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <main className="flex flex-1 justify-center px-4 py-6 sm:px-6">
      <div className="w-full max-w-2xl space-y-4">
        <header>
          <h1 className="font-display text-xl font-bold tracking-tight text-on-surface">
            Profile &amp; Settings
          </h1>
        </header>

        <form
          onSubmit={handleSaveProfile}
          className="space-y-4 rounded-[var(--radius-card)] border border-outline-variant bg-surface-container-lowest p-5 shadow-sm"
        >
          <h2 className="text-sm font-semibold text-on-surface">Profile &amp; goals</h2>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs text-on-surface-variant">
              Username
              <input
                value={form.username ?? ""}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                className="input"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-on-surface-variant">
              Current weight (kg)
              <input
                type="number"
                value={weightKg}
                onChange={(e) => setWeightKg(Number(e.target.value))}
                className="input"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-on-surface-variant">
              Height (cm)
              <input
                type="number"
                value={form.height_cm ?? ""}
                onChange={(e) => setForm({ ...form, height_cm: Number(e.target.value) })}
                className="input"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-on-surface-variant">
              Age
              <input
                type="number"
                value={form.age_years ?? ""}
                onChange={(e) => setForm({ ...form, age_years: Number(e.target.value) })}
                className="input"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-on-surface-variant">
              Activity level
              <select
                value={form.activity_level ?? ""}
                onChange={(e) => setForm({ ...form, activity_level: e.target.value as ActivityLevel })}
                className="input"
              >
                {Object.entries(ACTIVITY_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-on-surface-variant">
              Dietary mode
              <select
                value={form.dietary_mode ?? "non_vegetarian"}
                onChange={(e) => setForm({ ...form, dietary_mode: e.target.value as DietaryMode })}
                className="input"
              >
                {Object.entries(DIET_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <div className="col-span-2 flex gap-2">
              {(Object.entries(GOAL_LABELS) as [Goal, string][]).map(([v, l]) => (
                <button
                  type="button"
                  key={v}
                  onClick={() => setForm({ ...form, goal: v })}
                  className={`flex-1 rounded-[var(--radius-control)] px-3 py-2 text-sm font-semibold ${
                    (form.goal ?? profile.goal) === v
                      ? "bg-primary text-on-primary"
                      : "bg-surface-container text-on-surface-variant"
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-on-surface">
            <input
              type="checkbox"
              checked={form.leaderboard_visible ?? profile.leaderboard_visible}
              onChange={(e) => setForm({ ...form, leaderboard_visible: e.target.checked })}
            />
            Show me on friends&apos; leaderboards
          </label>

          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-[var(--radius-control)] bg-primary py-3 text-sm font-semibold text-on-primary disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save & recalculate targets"}
          </button>
          {saveError && <p className="text-sm text-fat">{saveError}</p>}
          {saveNotice && <p className="text-sm text-primary">{saveNotice}</p>}
        </form>

        <section className="rounded-[var(--radius-card)] border border-outline-variant bg-surface-container-lowest p-5 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold text-on-surface">Glass sizes</h2>
          <ul className="mb-3 space-y-1">
            {glassSizes.map((g) => (
              <li key={g.id} className="flex items-center justify-between text-sm">
                <span className="text-on-surface">
                  {g.label} ({g.volume_ml}ml)
                </span>
                <button
                  onClick={() => handleDeleteGlassSize(g.id)}
                  className="text-xs text-fat"
                  aria-label={`Remove ${g.label}`}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <div className="flex items-end gap-2">
            <label className="flex flex-col gap-1 text-xs text-on-surface-variant">
              Label
              <input
                value={newGlassLabel}
                onChange={(e) => setNewGlassLabel(e.target.value)}
                className="input w-28"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-on-surface-variant">
              ml
              <input
                type="number"
                value={newGlassVolume}
                onChange={(e) => setNewGlassVolume(Number(e.target.value))}
                className="input w-20"
              />
            </label>
            <button
              onClick={handleAddGlassSize}
              className="rounded-[var(--radius-control)] bg-primary px-3 py-2 text-xs font-semibold text-on-primary"
            >
              Add
            </button>
          </div>
        </section>

        <section className="rounded-[var(--radius-card)] border border-outline-variant bg-surface-container-lowest p-5 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold text-on-surface">Appearance</h2>
          <ThemeToggle />
        </section>

        {notif && (
          <section className="rounded-[var(--radius-card)] border border-outline-variant bg-surface-container-lowest p-5 shadow-sm">
            <h2 className="mb-2 text-sm font-semibold text-on-surface">Notifications</h2>
            <label className="flex items-center justify-between py-1 text-sm text-on-surface">
              Logging reminders
              <input
                type="checkbox"
                checked={notif.logging_reminders_enabled}
                onChange={(e) => setNotif({ ...notif, logging_reminders_enabled: e.target.checked })}
              />
            </label>
            <label className="flex items-center justify-between py-1 text-sm text-on-surface">
              Streak-at-risk warnings
              <input
                type="checkbox"
                checked={notif.streak_warnings_enabled}
                onChange={(e) => setNotif({ ...notif, streak_warnings_enabled: e.target.checked })}
              />
            </label>
            <label className="flex items-center justify-between py-1 text-sm text-on-surface">
              Macro-close-to-goal nudges
              <input
                type="checkbox"
                checked={notif.macro_nudges_enabled}
                onChange={(e) => setNotif({ ...notif, macro_nudges_enabled: e.target.checked })}
              />
            </label>
            <div className="mt-2 flex items-center gap-2">
              <label className="flex flex-col gap-1 text-xs text-on-surface-variant">
                Quiet hours start
                <input
                  type="time"
                  value={notif.quiet_hours_start ?? ""}
                  onChange={(e) => setNotif({ ...notif, quiet_hours_start: e.target.value || null })}
                  className="input"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-on-surface-variant">
                End
                <input
                  type="time"
                  value={notif.quiet_hours_end ?? ""}
                  onChange={(e) => setNotif({ ...notif, quiet_hours_end: e.target.value || null })}
                  className="input"
                />
              </label>
            </div>
            <button
              onClick={handleSaveNotifications}
              className="mt-3 w-full rounded-[var(--radius-control)] bg-primary py-2 text-sm font-semibold text-on-primary"
            >
              Save notification preferences
            </button>
          </section>
        )}

        <button
          onClick={handleLogout}
          className="w-full rounded-[var(--radius-control)] border border-outline-variant py-3 text-sm font-semibold text-fat"
        >
          Log out
        </button>
      </div>
    </main>
  );
}
