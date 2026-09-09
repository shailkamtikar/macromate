const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type BiologicalSex = "male" | "female";
export type ActivityLevel =
  | "sedentary"
  | "light"
  | "moderate"
  | "active"
  | "very_active";
export type Goal = "cut" | "maintain" | "bulk";

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
}

export class ApiError extends Error {}

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
    throw new ApiError(`macro-targets request failed (${res.status}): ${body}`);
  }
  return res.json();
}
