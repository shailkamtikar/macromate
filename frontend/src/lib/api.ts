import { supabase } from "@/lib/supabaseClient";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type BiologicalSex = "male" | "female";
export type ActivityLevel =
  | "sedentary"
  | "light"
  | "moderate"
  | "active"
  | "very_active";
export type Goal = "cut" | "maintain" | "bulk";
export type MealType = "breakfast" | "lunch" | "dinner" | "snack";

export interface MacroTargetsRequest {
  weight_kg: number;
  height_cm: number;
  age_years: number;
  sex: BiologicalSex;
  activity_level: ActivityLevel;
  goal: Goal;
}

export interface MacroTargets {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

export interface MacroTargetsResponse {
  bmi: number;
  bmi_category: string;
  targets: MacroTargets;
  water_goal_ml: number;
}

export interface FoodItem {
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
  similarity?: number | null;
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

export interface FoodLog {
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

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    throw new ApiError("Not signed in", 401);
  }
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      ...init.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new ApiError(`${path} failed (${res.status}): ${body}`, res.status);
  }
  return res;
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

export async function logFood(
  food_item_id: string,
  meal_type: MealType,
  quantity: number,
): Promise<FoodLog> {
  const res = await authFetch("/api/food-logs", {
    method: "POST",
    body: JSON.stringify({ food_item_id, meal_type, quantity }),
  });
  return res.json();
}

export async function fetchFoodLogs(date: string): Promise<FoodLog[]> {
  const res = await authFetch(`/api/food-logs?date=${date}`);
  return res.json();
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

export async function logWater(volume_ml: number): Promise<WaterLog> {
  const res = await authFetch("/api/water-logs", {
    method: "POST",
    body: JSON.stringify({ volume_ml }),
  });
  return res.json();
}

export async function deleteWaterLog(id: string): Promise<void> {
  await authFetch(`/api/water-logs/${id}`, { method: "DELETE" });
}

export interface ParsedFoodItem {
  raw_phrase: string;
  resolved: boolean;
  food_item_id: string | null;
  food_name: string | null;
  quantity_multiplier: number;
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
}

export interface CalculateFoodsResponse {
  items: ParsedFoodItem[];
  total: { calories: number; protein_g: number; carbs_g: number; fat_g: number };
}

export async function calculateFoodsWithAi(text: string): Promise<CalculateFoodsResponse> {
  const res = await authFetch("/api/ai/calculate-foods", {
    method: "POST",
    body: JSON.stringify({ text }),
  });
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
  suggestions: SuggestedFood[];
}

export async function fetchSuggestions(): Promise<SuggestionsResponse> {
  const res = await authFetch("/api/suggestions");
  return res.json();
}

export interface CoachMessage {
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export async function fetchCoachHistory(): Promise<CoachMessage[]> {
  const res = await authFetch("/api/ai/coach/history");
  return res.json();
}

export async function sendCoachMessage(message: string): Promise<CoachMessage> {
  const res = await authFetch("/api/ai/coach/message", {
    method: "POST",
    body: JSON.stringify({ message }),
  });
  return res.json();
}
