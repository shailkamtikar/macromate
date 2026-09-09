"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ActivityLevel,
  DietaryMode,
  GlassSize,
  Goal,
  MacroMode,
  MacroTargetsResponse,
  NotificationSettings,
  createGlassSize,
  deleteGlassSize,
  fetchGlassSizes,
  fetchNotificationSettings,
  updateNotificationSettings,
} from "@/lib/api";
import { ACTIVITY_LEVEL_INFO, ACTIVITY_LEVEL_ORDER } from "@/lib/activityLevels";
import { NumericField } from "@/components/NumericField";
import { RatePicker } from "@/components/RatePicker";
import { TargetsEditor } from "@/components/TargetsEditor";
import { supabase } from "@/lib/supabaseClient";
import { Profile, useProfile } from "@/lib/useProfile";
import { useSession } from "@/lib/useSession";
import { ThemeToggle } from "@/components/ThemeToggle";

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

  // The user's real current weight lives in weight_logs (most recent
  // entry), not on the profiles row — this must load the actual latest
  // value and never fall back to a hardcoded placeholder.
  const [latestWeightKg, setLatestWeightKg] = useState<number | null | undefined>(undefined);
  const [weightKg, setWeightKg] = useState<number | null>(null);
  // Guards against a real race: the initial weight_logs fetch below is
  // async and can resolve *after* the user has already edited the weight
  // field (e.g. the panel opens instantly now that it's an in-page drawer
  // rather than a full navigation, giving the user much less "dead time"
  // before they can start typing) — without this, that late resolution
  // would silently clobber their edit back to the last persisted value.
  const weightEditedRef = useRef(false);

  const [rateKgPerWeek, setRateKgPerWeek] = useState<number | null>(null);
  const [macroMode, setMacroMode] = useState<MacroMode>("automatic");
  const [targetsResult, setTargetsResult] = useState<MacroTargetsResponse | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  const [glassSizes, setGlassSizes] = useState<GlassSize[]>([]);
  const [newGlassLabel, setNewGlassLabel] = useState("");
  const [newGlassVolume, setNewGlassVolume] = useState(250);

  const [notif, setNotif] = useState<NotificationSettings | null>(null);

  useEffect(() => {
    if (!profile) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs local edit state when the loaded profile arrives
    setForm(profile);
    setRateKgPerWeek(profile.rate_kg_per_week);
    setMacroMode(profile.macro_mode);
  }, [profile]);

  useEffect(() => {
    if (!session) return;
    fetchGlassSizes().then(setGlassSizes).catch(() => {});
    fetchNotificationSettings().then(setNotif).catch(() => {});

    supabase
      .from("weight_logs")
      .select("weight_kg")
      .eq("user_id", session.user.id)
      .order("logged_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        const value = data?.weight_kg ?? null;
        setLatestWeightKg(value);
        if (!weightEditedRef.current) setWeightKg(value);
      });
  }, [session]);

  if (sessionLoading || profile === undefined || latestWeightKg === undefined) {
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

  const effectiveGoal = (form.goal ?? currentProfile.goal) as Goal;
  // Never fall back to a placeholder weight (0, 75, or otherwise) — if
  // there's genuinely no known weight yet, target calculation simply
  // doesn't run until the user enters one (see the TargetsEditor guard
  // below), rather than silently computing against a fake number.
  const effectiveWeight = weightKg ?? latestWeightKg ?? null;
  const hasValidWeight = effectiveWeight !== null && effectiveWeight > 0;

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!hasValidWeight) {
      setSaveError("Enter your current weight before saving.");
      return;
    }
    if (!targetsResult) {
      setSaveError("Targets haven't finished calculating yet — wait a moment and try again.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    setSaveNotice(null);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({
          username: form.username ?? currentProfile.username,
          sex: form.sex ?? currentProfile.sex,
          age_years: form.age_years ?? currentProfile.age_years,
          height_cm: form.height_cm ?? currentProfile.height_cm,
          activity_level: form.activity_level ?? currentProfile.activity_level,
          goal: effectiveGoal,
          rate_kg_per_week: effectiveGoal === "maintain" ? null : rateKgPerWeek,
          macro_mode: macroMode,
          dietary_mode: form.dietary_mode ?? "non_vegetarian",
          leaderboard_visible: form.leaderboard_visible ?? currentProfile.leaderboard_visible,
          target_calories: targetsResult.targets.calories,
          target_protein_g: targetsResult.targets.protein_g,
          target_carbs_g: targetsResult.targets.carbs_g,
          target_fat_g: targetsResult.targets.fat_g,
          water_goal_ml: targetsResult.water_goal_ml,
        })
        .eq("id", currentSession.user.id);
      if (error) throw error;

      // Only log a new weight entry if it actually changed — avoids
      // spamming weight_logs (and skewing the weight trend graph) with a
      // duplicate row every time the user saves unrelated settings.
      if (weightKg !== null && weightKg !== latestWeightKg) {
        const { error: weightError } = await supabase
          .from("weight_logs")
          .insert({ user_id: currentSession.user.id, weight_kg: weightKg });
        if (weightError) throw weightError;
        setLatestWeightKg(weightKg);
      }

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
              <NumericField
                min={1}
                max={400}
                value={weightKg ?? 0}
                onLiveChange={(n) => {
                  weightEditedRef.current = true;
                  setWeightKg(n > 0 ? n : null);
                }}
                onCommit={(n) => {
                  weightEditedRef.current = true;
                  setWeightKg(n > 0 ? n : null);
                }}
                className="input"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-on-surface-variant">
              Height (cm)
              <NumericField
                min={1}
                max={280}
                value={form.height_cm ?? 0}
                onLiveChange={(n) => setForm({ ...form, height_cm: n })}
                onCommit={(n) => setForm({ ...form, height_cm: n })}
                className="input"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-on-surface-variant">
              Age
              <NumericField
                min={1}
                max={120}
                value={form.age_years ?? 0}
                onLiveChange={(n) => setForm({ ...form, age_years: n })}
                onCommit={(n) => setForm({ ...form, age_years: n })}
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
                {ACTIVITY_LEVEL_ORDER.map((v) => (
                  <option key={v} value={v}>
                    {ACTIVITY_LEVEL_INFO[v].label}
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
                  onClick={() => {
                    setForm({ ...form, goal: v });
                    setRateKgPerWeek(null);
                  }}
                  className={`flex-1 rounded-[var(--radius-control)] px-3 py-2 text-sm font-semibold ${
                    effectiveGoal === v
                      ? "bg-primary text-on-primary"
                      : "bg-surface-container text-on-surface-variant"
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>

          {effectiveGoal !== "maintain" && (
            <div className="space-y-1">
              <p className="text-xs font-semibold text-on-surface">
                {effectiveGoal === "cut" ? "Weight-loss" : "Weight-gain"} rate
              </p>
              <RatePicker goal={effectiveGoal} value={rateKgPerWeek} onChange={setRateKgPerWeek} />
            </div>
          )}

          <label className="flex items-center gap-2 text-sm text-on-surface">
            <input
              type="checkbox"
              checked={form.leaderboard_visible ?? profile.leaderboard_visible}
              onChange={(e) => setForm({ ...form, leaderboard_visible: e.target.checked })}
            />
            Show me on friends&apos; leaderboards
          </label>

          <div>
            <p className="mb-2 text-sm font-semibold text-on-surface">Calorie &amp; macro targets</p>
            {hasValidWeight ? (
              <TargetsEditor
                weightKg={effectiveWeight as number}
                heightCm={form.height_cm ?? currentProfile.height_cm}
                ageYears={form.age_years ?? currentProfile.age_years}
                sex={(form.sex ?? currentProfile.sex) as "male" | "female"}
                activityLevel={(form.activity_level ?? currentProfile.activity_level) as ActivityLevel}
                goal={effectiveGoal}
                rateKgPerWeek={rateKgPerWeek}
                onResult={setTargetsResult}
                onMacroModeChange={setMacroMode}
                initialCalorieOverride={currentProfile.target_calories}
                initialMacroMode={currentProfile.macro_mode}
                initialCustomMacros={
                  currentProfile.macro_mode === "custom"
                    ? {
                        protein_g: currentProfile.target_protein_g,
                        carbs_g: currentProfile.target_carbs_g,
                        fat_g: currentProfile.target_fat_g,
                      }
                    : null
                }
              />
            ) : (
              <p className="rounded-[var(--radius-card)] border border-dashed border-outline-variant bg-surface-container-lowest p-4 text-xs text-on-surface-variant">
                Enter your current weight above to calculate targets.
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={saving || !hasValidWeight || !targetsResult}
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
              <NumericField
                min={1}
                max={5000}
                value={newGlassVolume}
                onCommit={setNewGlassVolume}
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
