import { authFetch } from "@/lib/api/http";
import type { FoodLog, MacroTargets, MealType, ServingBasis } from "@/lib/api/data";

export interface FoodCandidate {
  food_item_id: string | null;
  food_name: string;
  serving_description: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  serving_weight: number | null;
  serving_weight_unit: string | null;
}

/** The literal amount+unit Gemini extracted from the text (e.g. "200g" ->
 * amount 200, unit "g"), before any conversion — see calculate-foods'
 * backend docstring for why the conversion itself never happens in Gemini. */
export type ParsedUnit = "g" | "ml" | "serving";

/** "database" for a real, matched food_items row; "ai_estimate" when no
 * confident match existed and Gemini's own nutrition estimate was used
 * instead (never presented as verified). null only while `ambiguous`. */
export type NutritionSource = "database" | "ai_estimate" | null;

export interface ParsedFoodItem extends ServingBasis {
  raw_phrase: string;
  search_name: string;
  amount: number;
  unit: ParsedUnit;
  resolved: boolean;
  ambiguous: boolean;
  source: NutritionSource;
  quantity_is_assumption: boolean;
  food_item_id: string | null;
  food_name: string | null;
  quantity: number | null;
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  assumption: string | null;
  candidates: FoodCandidate[] | null;
  estimate: FoodCandidate | null;
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

/** An AI-estimated food's nutrition per 1 unit of `quantity` passed to
 * logAiEstimateFood — mirrors the backend's AiEstimateInput shape. */
export interface AiEstimateInput {
  name: string;
  serving_description: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

/** Logs an AI-estimated food (no database match) -- creates its backing
 * food_items row server-side and a food_logs row flagged
 * source="ai_estimate", via the same /api/food-logs endpoint `logFood`
 * uses. */
export async function logAiEstimateFood(
  estimate: AiEstimateInput,
  meal_type: MealType,
  quantity: number,
): Promise<FoodLog> {
  const res = await authFetch("/api/food-logs", {
    method: "POST",
    body: JSON.stringify({ ai_estimate: estimate, meal_type, quantity }),
  });
  return res.json();
}

export type DietaryMode = "vegetarian" | "non_vegetarian" | "egg_inclusive";

export interface GeneratedMeal {
  meal_type: string;
  description: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

export interface GenerateDietResponse {
  meals: GeneratedMeal[];
  notes: string;
  target: MacroTargets;
  plan_total_calories: number;
  within_tolerance: boolean;
}

export async function generateDiet(dietary_mode: DietaryMode): Promise<GenerateDietResponse> {
  const res = await authFetch("/api/ai/generate-diet", {
    method: "POST",
    body: JSON.stringify({ dietary_mode }),
  });
  return res.json();
}

export interface CoachMessage {
  role: "user" | "assistant";
  content: string;
  created_at: string;
  // Only set on the direct response to the message that triggered it
  // (never on history replay) -- lets the UI show a "View in Today" link
  // when the Coach actually changed the user's data.
  action?: "add_food" | "remove_food" | "log_water" | null;
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
