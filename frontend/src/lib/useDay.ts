"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import {
  Achievements,
  Day,
  FoodLog,
  GlassSize,
  MealType,
  SuggestedFood,
  SuggestionsResponse,
  createGlassSize,
  deleteFoodLog,
  fetchAchievements,
  fetchDay,
  fetchSuggestions,
  logFood,
  logWater,
  removeWater,
  updateFoodLog,
} from "@/lib/api";
import { localDateIso } from "@/lib/date";
import { friendlyMessage } from "@/lib/errors";
import { inferMealType } from "@/lib/servings";
import { nextTempId } from "@/lib/tempId";

const dayKey = (date: string) => ["day", date] as const;

/** Everything the dashboard needs for one calendar day, plus every mutation
 * on it, with optimistic updates:
 *  - the day itself loads from one request (GET /api/days/{date}) and is
 *    cached per date, so revisiting a date paints instantly;
 *  - "What to eat next" and the streak chip only exist for *today* and load
 *    after the day is on screen, so they can never block it;
 *  - each mutation patches the cached day immediately, then confirms or
 *    rolls back when the server answers. */
export function useDay(date: string, enabled: boolean) {
  const qc = useQueryClient();
  const isToday = date === localDateIso();
  const key = dayKey(date);
  const [actionError, setActionError] = useState<string | null>(null);
  const [logActionBusy, setLogActionBusy] = useState<string | null>(null);
  // Bumped after every food mutation so the picker's recent/frequent lists
  // refresh -- same role as the old `diaryVersion`.
  const [diaryVersion, setDiaryVersion] = useState(0);

  // Entries the user deleted but whose server delete hasn't been sent yet
  // (the Undo window). A background refetch must not bring them back.
  const pendingDeletes = useRef(new Set<string>());

  const dayQuery = useQuery({
    queryKey: key,
    queryFn: () => fetchDay(date),
    enabled,
    select: (d: Day) =>
      pendingDeletes.current.size === 0
        ? d
        : { ...d, meals: d.meals.filter((l) => !pendingDeletes.current.has(l.id)) },
  });
  const day = dayQuery.data ?? null;

  const suggestionsQuery = useQuery({
    queryKey: ["suggestions"],
    queryFn: fetchSuggestions,
    enabled: enabled && isToday && dayQuery.isSuccess,
    staleTime: 45_000,
  });
  const achievementsQuery = useQuery({
    queryKey: ["achievements"],
    queryFn: fetchAchievements,
    enabled: enabled && isToday && dayQuery.isSuccess,
  });

  const patchDay = useCallback(
    (fn: (d: Day) => Day) => {
      qc.setQueryData<Day>(key, (d) => (d ? fn(d) : d));
    },
    [qc, key],
  );

  // Things a food change can affect elsewhere.
  const foodChanged = useCallback(() => {
    setDiaryVersion((v) => v + 1);
    qc.invalidateQueries({ queryKey: ["suggestions"] });
    qc.invalidateQueries({ queryKey: ["achievements"] });
    qc.invalidateQueries({ queryKey: ["days-summary"] });
  }, [qc]);

  // ---- water ------------------------------------------------------------
  // Water total is a plain sum, so the optimistic delta *is* the correct
  // total; rollback reverses exactly that delta so it cannot clobber another
  // still-in-flight water change.
  const quickWater = useCallback(
    async (volumeMl: number) => {
      setActionError(null);
      await qc.cancelQueries({ queryKey: key });
      patchDay((d) => ({ ...d, water: { ...d.water, total_ml: d.water.total_ml + volumeMl } }));
      try {
        await logWater(volumeMl, isToday ? undefined : date);
        qc.invalidateQueries({ queryKey: ["days-summary"] });
      } catch (err) {
        patchDay((d) => ({ ...d, water: { ...d.water, total_ml: d.water.total_ml - volumeMl } }));
        setActionError(friendlyMessage(err, "water-log"));
      }
    },
    [qc, key, patchDay, isToday, date],
  );

  const undoWater = useCallback(
    async (volumeMl: number) => {
      setActionError(null);
      await qc.cancelQueries({ queryKey: key });
      patchDay((d) => ({
        ...d,
        water: { ...d.water, total_ml: Math.max(0, d.water.total_ml - volumeMl) },
      }));
      try {
        // The response is the server's own recomputed summary -- use it as
        // the authoritative correction.
        const summary = await removeWater(volumeMl, isToday ? undefined : date);
        patchDay((d) => ({ ...d, water: summary }));
        qc.invalidateQueries({ queryKey: ["days-summary"] });
      } catch (err) {
        patchDay((d) => ({ ...d, water: { ...d.water, total_ml: d.water.total_ml + volumeMl } }));
        setActionError(friendlyMessage(err, "water-log"));
      }
    },
    [qc, key, patchDay, isToday, date],
  );

  const addGlassSize = useCallback(
    async (label: string, volumeMl: number) => {
      setActionError(null);
      const tempId = nextTempId();
      patchDay((d) => ({
        ...d,
        glass_sizes: [...d.glass_sizes, { id: tempId, label, volume_ml: volumeMl }],
      }));
      try {
        const created = await createGlassSize(label, volumeMl);
        // Glass sizes are not tied to a date -- update every cached day.
        qc.setQueriesData<Day>({ queryKey: ["day"] }, (d) =>
          d
            ? {
                ...d,
                glass_sizes: d.glass_sizes.some((g: GlassSize) => g.id === tempId)
                  ? d.glass_sizes.map((g) => (g.id === tempId ? created : g))
                  : [...d.glass_sizes, created],
              }
            : d,
        );
      } catch (err) {
        patchDay((d) => ({ ...d, glass_sizes: d.glass_sizes.filter((g) => g.id !== tempId) }));
        setActionError(friendlyMessage(err, "glass-size"));
      }
    },
    [qc, patchDay],
  );

  // ---- food (the FoodPicker performs the request; these reconcile) ------
  const foodLogStart = useCallback(
    (entry: FoodLog) => {
      setActionError(null);
      qc.cancelQueries({ queryKey: key });
      patchDay((d) => ({ ...d, meals: [...d.meals, entry] }));
    },
    [qc, key, patchDay],
  );

  const foodLogSuccess = useCallback(
    (tempId: string, real: FoodLog) => {
      patchDay((d) => ({ ...d, meals: d.meals.map((l) => (l.id === tempId ? real : l)) }));
      foodChanged();
    },
    [patchDay, foodChanged],
  );

  const foodLogError = useCallback(
    (tempId: string, err: unknown) => {
      patchDay((d) => ({ ...d, meals: d.meals.filter((l) => l.id !== tempId) }));
      setActionError(friendlyMessage(err, "food-log-save"));
    },
    [patchDay],
  );

  const saveEntry = useCallback(
    async (logId: string, changes: { quantity?: number; meal_type?: MealType }) => {
      setActionError(null);
      setLogActionBusy(logId);
      await qc.cancelQueries({ queryKey: key });
      let previous: FoodLog | undefined;
      patchDay((d) => ({
        ...d,
        meals: d.meals.map((l) => {
          if (l.id !== logId) return l;
          previous = l;
          // A quantity change scales the logged nutrition proportionally --
          // the same arithmetic the server applies.
          const ratio =
            changes.quantity !== undefined && l.quantity > 0 ? changes.quantity / l.quantity : 1;
          return {
            ...l,
            quantity: changes.quantity ?? l.quantity,
            meal_type: changes.meal_type ?? l.meal_type,
            calories: l.calories * ratio,
            protein_g: l.protein_g * ratio,
            carbs_g: l.carbs_g * ratio,
            fat_g: l.fat_g * ratio,
          };
        }),
      }));
      try {
        const updated = await updateFoodLog(logId, changes);
        patchDay((d) => ({ ...d, meals: d.meals.map((l) => (l.id === logId ? updated : l)) }));
        if (changes.quantity !== undefined) foodChanged();
      } catch (err) {
        patchDay((d) => ({
          ...d,
          meals: d.meals.map((l) => (l.id === logId && previous ? previous : l)),
        }));
        setActionError(friendlyMessage(err, "food-log-update"));
      } finally {
        setLogActionBusy(null);
      }
    },
    [qc, key, patchDay, foodChanged],
  );

  // ---- delete with undo -------------------------------------------------
  // hideEntry removes the row from the screen immediately; restoreEntry puts
  // it back (Undo); commitDelete is called when the Undo window closes and
  // performs the real delete, rolling the row back if the server refuses.
  const hideEntry = useCallback(
    (log: FoodLog) => {
      setActionError(null);
      pendingDeletes.current.add(log.id);
      qc.cancelQueries({ queryKey: key });
      patchDay((d) => ({ ...d, meals: d.meals.filter((l) => l.id !== log.id) }));
    },
    [qc, key, patchDay],
  );

  const restoreEntry = useCallback(
    (log: FoodLog) => {
      pendingDeletes.current.delete(log.id);
      patchDay((d) =>
        d.meals.some((l) => l.id === log.id)
          ? d
          : {
              ...d,
              meals: [...d.meals, log].sort((a, b) => a.logged_at.localeCompare(b.logged_at)),
            },
      );
    },
    [patchDay],
  );

  const commitDelete = useCallback(
    async (log: FoodLog) => {
      setLogActionBusy(log.id);
      try {
        await deleteFoodLog(log.id);
        pendingDeletes.current.delete(log.id);
        foodChanged();
      } catch (err) {
        restoreEntry(log);
        setActionError(friendlyMessage(err, "food-log-delete"));
      } finally {
        setLogActionBusy(null);
      }
    },
    [foodChanged, restoreEntry],
  );

  const addSuggestion = useCallback(
    async (food: SuggestedFood) => {
      setActionError(null);
      await qc.cancelQueries({ queryKey: key });
      const tempId = nextTempId();
      const mealType = inferMealType();
      patchDay((d) => ({
        ...d,
        meals: [
          ...d.meals,
          {
            id: tempId,
            food_item_id: food.id,
            food_name: food.name,
            meal_type: mealType,
            quantity: 1,
            calories: food.calories,
            protein_g: food.protein_g,
            carbs_g: food.carbs_g,
            fat_g: food.fat_g,
            logged_at: new Date().toISOString(),
            source: "database",
            serving_description: food.serving_description,
          },
        ],
      }));
      try {
        const log = await logFood(food.id, mealType, 1);
        patchDay((d) => ({ ...d, meals: d.meals.map((l) => (l.id === tempId ? log : l)) }));
        foodChanged();
      } catch (err) {
        patchDay((d) => ({ ...d, meals: d.meals.filter((l) => l.id !== tempId) }));
        setActionError(friendlyMessage(err, "food-log-save"));
      }
    },
    [qc, key, patchDay, foodChanged],
  );

  return {
    day,
    isToday,
    loadError:
      dayQuery.isError && !dayQuery.data ? friendlyMessage(dayQuery.error, "diary-load") : null,
    retry: () => dayQuery.refetch(),
    suggestions: (suggestionsQuery.data ?? null) as SuggestionsResponse | null,
    suggestionsLoading: suggestionsQuery.isLoading,
    suggestionsError: suggestionsQuery.isError && !suggestionsQuery.data,
    retrySuggestions: () => suggestionsQuery.refetch(),
    achievements: (achievementsQuery.data ?? null) as Achievements | null,
    actionError,
    logActionBusy,
    diaryVersion,
    quickWater,
    undoWater,
    addGlassSize,
    foodLogStart,
    foodLogSuccess,
    foodLogError,
    saveEntry,
    hideEntry,
    restoreEntry,
    commitDelete,
    addSuggestion,
  };
}
