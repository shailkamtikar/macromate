"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useSession } from "@/lib/useSession";

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
  timezone: string;
  rate_kg_per_week: number | null;
  macro_mode: "automatic" | "custom";
}

interface ProfileState {
  profile: Profile | null | undefined;
  refetch: () => Promise<void>;
}

const ProfileContext = createContext<ProfileState | null>(null);

/** Resolves the user's profile once per session (per userId), instead of
 * every one of the 4 components that need it (Today, AppSidebar, Profile,
 * Onboarding) independently re-fetching it on every mount -- previously,
 * navigating between any two of those pages re-triggered a full
 * useState(undefined) -> fetch -> setState cycle each time, showing a
 * plain "Loading…" flash on every single navigation even though the
 * profile itself rarely changes mid-session. Consumers that mutate the
 * profile (Profile page's save, Onboarding's completion) call
 * useRefetchProfile() explicitly afterward so the shared cache never goes
 * stale after a real change. */
export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const { session } = useSession();
  const userId = session?.user.id;
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);
  const userIdRef = useRef(userId);
  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  const fetchFor = useCallback(async (uid: string) => {
    const { data } = await supabase.from("profiles").select("*").eq("id", uid).maybeSingle();
    // Only apply the result if this is still the current user -- avoids a
    // slow, stale fetch from a just-logged-out user clobbering the next
    // user's state.
    if (userIdRef.current === uid) setProfile(data as Profile | null);
  }, []);

  useEffect(() => {
    if (!userId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on logout, not a data-fetch sync
      setProfile(undefined);
      return;
    }
    setProfile(undefined);
    fetchFor(userId);
  }, [userId, fetchFor]);

  const refetch = useCallback(async () => {
    if (userIdRef.current) await fetchFor(userIdRef.current);
  }, [fetchFor]);

  return <ProfileContext.Provider value={{ profile, refetch }}>{children}</ProfileContext.Provider>;
}

function useProfileContext(): ProfileState {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error("useProfile must be used within a ProfileProvider");
  return ctx;
}

/** Same return shape every existing caller already expects (undefined =
 * loading, null = no profile yet, Profile = loaded) -- the `userId`
 * parameter is accepted but ignored (the provider already knows the
 * current session's user), kept only so no call site needs to change. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept only for call-site compatibility, see comment above
export function useProfile(_userId?: string): Profile | null | undefined {
  return useProfileContext().profile;
}

/** Call after directly mutating the profiles row (Supabase update/upsert)
 * so every other consumer's cached copy catches up immediately instead of
 * waiting for a full reload or next login. */
export function useRefetchProfile(): () => Promise<void> {
  return useProfileContext().refetch;
}
