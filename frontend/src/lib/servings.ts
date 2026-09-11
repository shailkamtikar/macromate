import { MealType, ServingBasis } from "@/lib/api";

export const MEAL_TYPES: MealType[] = ["breakfast", "lunch", "dinner", "snack"];

export const MEAL_LABELS: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snacks",
};

/** What the user picks in the amount field. "serving" is always available;
 * a weight unit is offered only when the food itself declares a per-serving
 * weight, so nothing is ever converted from a made-up basis. */
export type ServingUnit = "serving" | "weight";

export interface UnitOption {
  value: ServingUnit;
  label: string;
}

export function servingWeight(basis: ServingBasis): number | null {
  const amount = basis.serving_weight;
  return typeof amount === "number" && amount > 0 ? amount : null;
}

export function weightUnitLabel(basis: ServingBasis): string {
  return basis.serving_weight_unit === "ml" ? "ml" : "g";
}

export function unitOptions(basis: ServingBasis): UnitOption[] {
  const options: UnitOption[] = [{ value: "serving", label: "serving" }];
  if (servingWeight(basis) !== null) {
    options.push({ value: "weight", label: weightUnitLabel(basis) });
  }
  return options;
}

/** Converts what's shown in the amount field into the servings multiplier
 * the food log actually stores. */
export function amountToQuantity(
  amount: number,
  unit: ServingUnit,
  basis: ServingBasis,
): number {
  if (unit === "serving") return amount;
  const weight = servingWeight(basis);
  if (weight === null) return amount;
  return amount / weight;
}

/** Inverse of amountToQuantity — the number to prefill the amount field
 * with for an existing entry. */
export function quantityToAmount(
  quantity: number,
  unit: ServingUnit,
  basis: ServingBasis,
): number {
  if (unit === "serving") return roundAmount(quantity);
  const weight = servingWeight(basis);
  if (weight === null) return roundAmount(quantity);
  return roundAmount(quantity * weight);
}

function roundAmount(value: number): number {
  // Two decimals is enough precision for a food amount and avoids
  // 0.30000000000000004 showing up in an input.
  return Math.round(value * 100) / 100;
}

/** Human-readable amount for a logged entry: "300 g" when the food has a
 * known serving weight, otherwise "2 x 1 bowl". */
export function describeAmount(quantity: number, basis: ServingBasis): string {
  const weight = servingWeight(basis);
  if (weight !== null) {
    return `${roundAmount(quantity * weight)} ${weightUnitLabel(basis)}`;
  }
  const serving = basis.serving_description?.trim();
  const rounded = roundAmount(quantity);
  if (!serving) return `${rounded} serving${rounded === 1 ? "" : "s"}`;
  return rounded === 1 ? serving : `${rounded} × ${serving}`;
}

/** The meal a food logged right now most likely belongs to. */
export function inferMealType(now: Date = new Date()): MealType {
  const hour = now.getHours();
  if (hour < 11) return "breakfast";
  if (hour < 15) return "lunch";
  if (hour < 18) return "snack";
  return "dinner";
}
