"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export interface Profile {
  id: string;
  username: string;
  sex: "male" | "female";
  age_years: number;
  height_cm: number;
  activity_level: string;
  goal: "cut" | "maintain" | "bulk";
  dietary_mode: "vegetarian" | "non_vegetarian" | "egg_inclusive";
  target_calories: number;
  target_protein_g: number;
  target_carbs_g: number;
  target_fat_g: number;
  water_goal_ml: number | null;
  leaderboard_visible: boolean;
}

export function useProfile(userId: string | undefined) {
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);

  useEffect(() => {
    if (!userId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on userId change (e.g. logout)
      setProfile(undefined);
      return;
    }
    let cancelled = false;
    supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setProfile(data as Profile | null);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return profile; // undefined = loading, null = no profile yet, Profile = loaded
}
