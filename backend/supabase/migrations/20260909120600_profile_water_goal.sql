-- Daily water goal (PRD §3.1: "auto-suggested based on weight/activity,
-- editable by user"). Stored on profiles alongside the macro targets it's
-- suggested alongside; no default because every profile row is written by
-- the onboarding flow, which always supplies one.
alter table public.profiles add column water_goal_ml numeric;
