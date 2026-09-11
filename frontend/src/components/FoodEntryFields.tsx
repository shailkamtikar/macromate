"use client";

import { MealType, ServingBasis } from "@/lib/api";
import { NumericField } from "@/components/NumericField";
import {
  MEAL_LABELS,
  MEAL_TYPES,
  ServingUnit,
  unitOptions,
} from "@/lib/servings";

interface FoodEntryFieldsProps {
  basis: ServingBasis;
  amount: number;
  unit: ServingUnit;
  meal: MealType;
  onAmountChange: (amount: number) => void;
  onUnitChange: (unit: ServingUnit) => void;
  onMealChange: (meal: MealType) => void;
  /** Distinguishes this instance's inputs when several are on screen. */
  idPrefix: string;
  compact?: boolean;
}

/**
 * Amount + unit + meal — the three things a mature tracker lets you set
 * both when adding a food and when editing an already-logged entry. Shared
 * so the two flows can't drift apart.
 */
export function FoodEntryFields({
  basis,
  amount,
  unit,
  meal,
  onAmountChange,
  onUnitChange,
  onMealChange,
  idPrefix,
  compact = false,
}: FoodEntryFieldsProps) {
  const units = unitOptions(basis);

  return (
    <div className={compact ? "flex flex-wrap items-end gap-2" : "grid grid-cols-3 gap-2"}>
      <label
        className="flex flex-col gap-1 text-xs text-on-surface-variant"
        htmlFor={`${idPrefix}-amount`}
      >
        Quantity
        <NumericField
          id={`${idPrefix}-amount`}
          value={amount}
          min={0.01}
          max={100000}
          onLiveChange={onAmountChange}
          onCommit={onAmountChange}
          className={compact ? "input w-20" : "input"}
        />
      </label>

      <label
        className="flex flex-col gap-1 text-xs text-on-surface-variant"
        htmlFor={`${idPrefix}-unit`}
      >
        Unit
        <select
          id={`${idPrefix}-unit`}
          value={unit}
          onChange={(e) => onUnitChange(e.target.value as ServingUnit)}
          disabled={units.length === 1}
          className={compact ? "input w-24" : "input"}
        >
          {units.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label
        className="flex flex-col gap-1 text-xs text-on-surface-variant"
        htmlFor={`${idPrefix}-meal`}
      >
        Meal
        <select
          id={`${idPrefix}-meal`}
          value={meal}
          onChange={(e) => onMealChange(e.target.value as MealType)}
          className={compact ? "input w-28" : "input"}
        >
          {MEAL_TYPES.map((value) => (
            <option key={value} value={value}>
              {MEAL_LABELS[value]}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
