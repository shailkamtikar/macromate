import { API_URL, ApiError, authFetch } from "@/lib/api/http";

export type BiologicalSex = "male" | "female";
export type ActivityLevel =
  | "sedentary"
  | "light"
  | "moderate"
  | "active"
  | "very_active";
export type Goal = "cut" | "maintain" | "bulk";
export type MealType = "breakfast" | "lunch" | "dinner" | "snack";

export type MacroMode = "automatic" | "custom";

export interface MacroTargetsRequest {
  weight_kg: number;
  height_cm: number;
  age_years: number;
  sex: BiologicalSex;
  activity_level: ActivityLevel;
  goal: Goal;
  // Required for cut/bulk; ignored for maintain.
  rate_kg_per_week?: number | null;
  // Nudges the recommended calorie target; omit to use the recommendation
  // as-is.
  calorie_override?: number | null;
  macro_mode?: MacroMode;
  custom_protein_g?: number | null;
  custom_carbs_g?: number | null;
  custom_fat_g?: number | null;
}

export interface MacroTargets {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

export type CapReason = "tdee_fraction" | "bodyweight_percent" | "absolute_floor";

export interface MacroTargetsResponse {
  bmi: number;
  bmi_category: string;
  bmr: number;
  /** Estimated TDEE / maintenance calories — no cut/bulk adjustment.
   * Identical to maintenance_calories; both are present since the UI
   * shows this as a distinct, named "estimated maintenance" figure. */
  tdee: number;
  maintenance_calories: number;
  recommended_calories: number;
  /** The rate the user actually asked for — null for maintain, or if the
   * request omitted it. */
  requested_rate_kg_per_week: number | null;
  /** The rate actually applied after the safety/feasibility policy —
   * equals requested_rate_kg_per_week unless is_rate_capped is true. */
  applied_rate_kg_per_week: number | null;
  is_rate_capped: boolean;
  cap_reason: CapReason | null;
  /** Calm, ready-to-display explanation of why the rate was capped. */
  cap_explanation: string | null;
  /** Signed: negative for a cut, positive for a bulk, 0 for maintain. */
  daily_energy_change_kcal: number;
  /** Calm, non-medical advisory when the *final* calorie target is
   * unusually low — never a silent substitution. */
  low_calorie_warning: string | null;
  targets: MacroTargets;
  water_goal_ml: number;
}

// Weight-loss/gain rate options surfaced in onboarding + profile. Must
// match the bounds enforced server-side in app/domain/macros.py.
export const CUT_RATE_OPTIONS_KG_PER_WEEK = [0.5, 0.75, 1.0] as const;
export const BULK_RATE_OPTIONS_KG_PER_WEEK = [0.25] as const;
// A user may nudge the recommended calorie target by up to this many kcal
// in either direction — mirrors CALORIE_OVERRIDE_TOLERANCE_KCAL server-side.
export const CALORIE_OVERRIDE_TOLERANCE_KCAL = 500;
// Custom macros' implied calories must land within this fraction of the
// calorie target — mirrors MACRO_CALORIE_TOLERANCE_PCT server-side. Used
// only for an instant client-side preview; the server call is still the
// authoritative validation.
export const MACRO_CALORIE_TOLERANCE_PCT = 0.05;
export const MIN_SAFE_DAILY_CALORIES = 1200;

/** The weight of one serving, when the food's serving description states
 * one ("100g", "1 bowl (150 g)"). Null when it doesn't — the UI then offers
 * servings only rather than inventing a gram equivalent. */
export interface ServingBasis {
  serving_description?: string | null;
  serving_weight?: number | null;
  serving_weight_unit?: string | null;
}

export interface FoodItem extends ServingBasis {
  id: string;
  name: string;
  brand: string | null;
  serving_description: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  verified: boolean;
  created_by: string | null;
  /** True for the caller's own reusable food created from an accepted AI
   * estimate -- never verified, never visible to other users. */
  is_ai_estimate?: boolean;
  similarity?: number | null;
  /** Only present on recent/frequent results. */
  log_count?: number | null;
  last_logged_at?: string | null;
}

export interface RecentFoodsResponse {
  recent: FoodItem[];
  frequent: FoodItem[];
}

export interface CreateFoodRequest {
  name: string;
  brand?: string | null;
  serving_description: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g?: number | null;
  sugar_g?: number | null;
  sodium_mg?: number | null;
  force?: boolean;
}

export interface CreateFoodResponse {
  created: FoodItem | null;
  possible_duplicates: FoodItem[];
}

export interface FoodLog extends ServingBasis {
  id: string;
  food_item_id: string;
  food_name: string;
  meal_type: MealType;
  quantity: number;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  logged_at: string;
  // "database" for a verified/user-custom food (the only value before
  // Phase 3); "ai_estimate" when this log's nutrition came from a Gemini
  // estimate with no confident database match.
  source: "database" | "ai_estimate";
}

export interface GlassSize {
  id: string;
  label: string;
  volume_ml: number;
}

export interface WaterLog {
  id: string;
  volume_ml: number;
  logged_at: string;
}

export interface WaterSummary {
  total_ml: number;
  logs: WaterLog[];
}

export async function fetchMacroTargets(
  payload: MacroTargetsRequest,
): Promise<MacroTargetsResponse> {
  const res = await fetch(`${API_URL}/api/macro-targets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new ApiError(`macro-targets request failed (${res.status}): ${body}`, res.status);
  }
  return res.json();
}

export async function fetchMe(): Promise<{ user_id: string; email: string | null }> {
  return (await authFetch("/api/me")).json();
}

export async function searchFoods(query: string): Promise<FoodItem[]> {
  const res = await authFetch(`/api/foods/search?q=${encodeURIComponent(query)}`);
  return (await res.json()).results;
}

export async function createFood(
  payload: CreateFoodRequest,
): Promise<CreateFoodResponse> {
  const res = await authFetch("/api/foods", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return res.json();
}

/** `logDate` (YYYY-MM-DD, the user's local date) backfills a past day;
 * omit it to log "now". */
export async function logFood(
  food_item_id: string,
  meal_type: MealType,
  quantity: number,
  logDate?: string,
): Promise<FoodLog> {
  const res = await authFetch("/api/food-logs", {
    method: "POST",
    body: JSON.stringify({ food_item_id, meal_type, quantity, log_date: logDate }),
  });
  return res.json();
}

export async function fetchFoodLogs(date: string): Promise<FoodLog[]> {
  const res = await authFetch(`/api/food-logs?date=${date}`);
  return res.json();
}

export async function fetchRecentFoods(): Promise<RecentFoodsResponse> {
  const res = await authFetch("/api/foods/recent");
  return res.json();
}

/** Change an entry's quantity, move it to another meal, or both. */
export async function updateFoodLog(
  logId: string,
  changes: { quantity?: number; meal_type?: MealType },
): Promise<FoodLog> {
  const res = await authFetch(`/api/food-logs/${logId}`, {
    method: "PATCH",
    body: JSON.stringify(changes),
  });
  return res.json();
}

export async function deleteFoodLog(logId: string): Promise<void> {
  await authFetch(`/api/food-logs/${logId}`, { method: "DELETE" });
}

export async function fetchGlassSizes(): Promise<GlassSize[]> {
  const res = await authFetch("/api/glass-sizes");
  return res.json();
}

export async function createGlassSize(
  label: string,
  volume_ml: number,
): Promise<GlassSize> {
  const res = await authFetch("/api/glass-sizes", {
    method: "POST",
    body: JSON.stringify({ label, volume_ml }),
  });
  return res.json();
}

export async function deleteGlassSize(id: string): Promise<void> {
  await authFetch(`/api/glass-sizes/${id}`, { method: "DELETE" });
}

export async function fetchWaterLogs(date: string): Promise<WaterSummary> {
  const res = await authFetch(`/api/water-logs?date=${date}`);
  return res.json();
}

export async function logWater(volume_ml: number, logDate?: string): Promise<WaterLog> {
  const res = await authFetch("/api/water-logs", {
    method: "POST",
    body: JSON.stringify({ volume_ml, log_date: logDate }),
  });
  return res.json();
}

/** Undo one container's worth of today's water, newest entry first —
 * the "−" control on the glass tracker. Returns the corrected summary. */
export async function removeWater(volume_ml: number, logDate?: string): Promise<WaterSummary> {
  const res = await authFetch("/api/water-logs/remove", {
    method: "POST",
    body: JSON.stringify({ volume_ml, log_date: logDate }),
  });
  return res.json();
}

export async function deleteWaterLog(id: string): Promise<void> {
  await authFetch(`/api/water-logs/${id}`, { method: "DELETE" });
}

export interface NotificationSettings {
  notifications_enabled: boolean;
  logging_reminders_enabled: boolean;
  reminder_times: string[];
  streak_warnings_enabled: boolean;
  macro_nudges_enabled: boolean;
  friend_activity_enabled: boolean;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
}

export async function fetchNotificationSettings(): Promise<NotificationSettings> {
  const res = await authFetch("/api/notification-settings");
  return res.json();
}

export async function updateNotificationSettings(
  settings: NotificationSettings,
): Promise<NotificationSettings> {
  const res = await authFetch("/api/notification-settings", {
    method: "PUT",
    body: JSON.stringify(settings),
  });
  return res.json();
}

export interface NotificationTriggerOut {
  kind: string;
  title: string;
  body: string;
}

export async function fetchDueTriggers(): Promise<NotificationTriggerOut[]> {
  const res = await authFetch("/api/notification-settings/check-now");
  return res.json();
}

export interface ActivityLog {
  id: string;
  source: string;
  activity_date: string;
  steps: number | null;
  active_calories: number | null;
  workout_minutes: number | null;
}

export async function logManualActivity(
  activity_date: string,
  steps: number | null,
  workout_minutes: number | null,
): Promise<ActivityLog> {
  const res = await authFetch("/api/activity-logs", {
    method: "PUT",
    body: JSON.stringify({ activity_date, steps, workout_minutes }),
  });
  return res.json();
}

export async function fetchActivityLogs(start: string, end: string): Promise<ActivityLog[]> {
  const res = await authFetch(`/api/activity-logs?start=${start}&end=${end}`);
  return res.json();
}

export interface UserSearchResult {
  id: string;
  username: string;
}

export interface Friendship {
  id: string;
  status: "pending" | "accepted" | "declined";
  requester_id: string;
  addressee_id: string;
  other_username: string;
}

export interface LeaderboardEntry {
  user_id: string;
  username: string;
  discipline_score: number;
  days_logged: number;
  is_self: boolean;
  current_streak_days: number;
}

export interface FriendActivityItem {
  user_id: string;
  username: string;
  meal_type: string;
  logged_at: string;
  item_count: number;
}

export async function searchUsers(q: string): Promise<UserSearchResult[]> {
  const res = await authFetch(`/api/friends/search?q=${encodeURIComponent(q)}`);
  return res.json();
}

export async function sendFriendRequest(username: string): Promise<Friendship> {
  const res = await authFetch("/api/friends/request", {
    method: "POST",
    body: JSON.stringify({ username }),
  });
  return res.json();
}

export async function fetchFriendships(): Promise<Friendship[]> {
  const res = await authFetch("/api/friends");
  return res.json();
}

export async function respondToFriendRequest(id: string, accept: boolean): Promise<Friendship> {
  const res = await authFetch(`/api/friends/${id}/respond`, {
    method: "POST",
    body: JSON.stringify({ accept }),
  });
  return res.json();
}

export async function fetchLeaderboard(): Promise<LeaderboardEntry[]> {
  const res = await authFetch("/api/friends/leaderboard");
  return res.json();
}

export async function fetchFriendActivity(): Promise<FriendActivityItem[]> {
  const res = await authFetch("/api/friends/activity");
  return res.json();
}

export interface Achievements {
  current_streak_days: number;
  milestones_hit: number[];
  newest_milestone: number | null;
  weight_lower_than_last: boolean;
  weight_delta_kg: number | null;
  calorie_goal_hit_today: boolean;
  macro_goals_hit_today: Record<string, boolean>;
}

export async function fetchAchievements(): Promise<Achievements> {
  const res = await authFetch("/api/achievements");
  return res.json();
}

export interface WeekSummary {
  week_start: string;
  week_end: string;
  avg_calories: number;
  avg_protein_g: number;
  avg_carbs_g: number;
  avg_fat_g: number;
  days_logged: number;
  days_goal_hit: number;
  adherence_pct: number;
  /** Calendar days this summary actually covers -- 7 for any complete
   * week, fewer only for the currently-in-progress week. */
  days_in_period: number;
  is_partial: boolean;
  protein_days_hit: number;
  protein_adherence_pct: number;
  carbs_days_hit: number;
  carbs_adherence_pct: number;
  fat_days_hit: number;
  fat_adherence_pct: number;
}

export interface WeeklyReport {
  current: WeekSummary;
  previous: WeekSummary;
  weight_start_kg: number | null;
  weight_end_kg: number | null;
  weight_delta_kg: number | null;
  wins: string[];
  improvement_areas: string[];
}

/** `refDate` (YYYY-MM-DD) requests the report for the week containing that
 * date instead of the current week -- the backend already supports this. */
export async function fetchWeeklyReport(refDate?: string): Promise<WeeklyReport> {
  const qs = refDate ? `?ref_date=${encodeURIComponent(refDate)}` : "";
  const res = await authFetch(`/api/progress/weekly${qs}`);
  return res.json();
}

export interface SuggestedFood {
  id: string;
  name: string;
  brand: string | null;
  serving_description: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  verified: boolean;
}

export interface SuggestionsResponse {
  message: string;
  remaining_calories: number;
  remaining_protein_g: number;
  remaining_carbs_g: number;
  remaining_fat_g: number;
  /** Whether these suggestions are currently ranked to close a real
   * protein gap, vs. protein already being on track for the day. */
  protein_is_priority: boolean;
  suggestions: SuggestedFood[];
}

export async function fetchSuggestions(): Promise<SuggestionsResponse> {
  const res = await authFetch("/api/suggestions");
  return res.json();
}


// ---------------------------------------------------------------------------
// Calendar: everything the dashboard shows for one day, and a per-day
// overview of a date range (see backend/app/routers/days.py).
// ---------------------------------------------------------------------------
export type DayStatus = "low" | "ok" | "high" | "none";

export interface DayTargets {
  calories: number;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  water_goal_ml: number | null;
  /** True when no real target history covers this day (back-filled from
   * the targets in force when the history feature started). */
  is_approximate: boolean;
}

export interface Day {
  date: string;
  is_today: boolean;
  timezone: string;
  targets: DayTargets;
  consumed: { calories: number; protein_g: number; carbs_g: number; fat_g: number };
  status: { calories: DayStatus; protein: DayStatus; carbs: DayStatus; fat: DayStatus };
  meals: FoodLog[];
  water: WaterSummary;
  glass_sizes: GlassSize[];
  activity: ActivityLog | null;
  weight_kg: number | null;
}

export interface DaySummary {
  date: string;
  logged: boolean;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  water_ml: number;
  target_calories: number;
  status: { calories: DayStatus; protein: DayStatus; carbs: DayStatus; fat: DayStatus };
}

export async function fetchDay(date: string): Promise<Day> {
  const res = await authFetch(`/api/days/${date}`);
  return res.json();
}

export async function fetchDaysSummary(start: string, end: string): Promise<DaySummary[]> {
  const res = await authFetch(`/api/days/summary?start=${start}&end=${end}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Profile: the browser sends INPUTS only; the server recomputes and stores the
// calorie/macro targets (it is the only writer of profile targets and weight).
// ---------------------------------------------------------------------------
export interface ProfileInput extends MacroTargetsRequest {
  username: string;
  dietary_mode: DietaryModeInput;
  leaderboard_visible: boolean;
  timezone?: string;
}

export type DietaryModeInput = "vegetarian" | "non_vegetarian" | "egg_inclusive";

export interface ProfileSaved {
  profile: {
    id: string;
    username: string;
    target_calories: number;
    target_protein_g: number;
    target_carbs_g: number;
    target_fat_g: number;
    water_goal_ml: number | null;
    timezone: string;
  };
  targets: MacroTargetsResponse;
  weight_kg: number;
}

export async function saveProfile(input: ProfileInput): Promise<ProfileSaved> {
  const res = await authFetch("/api/profile", { method: "PUT", body: JSON.stringify(input) });
  return res.json();
}

export interface WeightLog {
  id: string;
  weight_kg: number;
  logged_at: string;
}

/** `logDate` (YYYY-MM-DD) backfills a past day; omit it for "now". */
export async function logWeight(weight_kg: number, logDate?: string): Promise<WeightLog> {
  const res = await authFetch("/api/weight-logs", {
    method: "POST",
    body: JSON.stringify({ weight_kg, log_date: logDate }),
  });
  return res.json();
}
