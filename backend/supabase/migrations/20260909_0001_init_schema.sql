-- MacroMate initial schema — derived from docs/MACROMATE_PRD.md §5 (High-Level Data Model)
-- Auth is handled entirely by Supabase Auth (auth.users); every table here
-- that belongs to a user references auth.users(id), never reimplements auth.

create extension if not exists "pgcrypto";

-- =========================================================================
-- profiles — one row per auth.users row. Holds inputs to the deterministic
-- macro-calculation engine (backend/app/domain/macros.py) plus the cached
-- result, recomputed by the backend whenever inputs change.
-- =========================================================================
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text unique not null,
  sex text not null check (sex in ('male', 'female')),
  age_years integer not null check (age_years > 0),
  height_cm numeric not null check (height_cm > 0),
  activity_level text not null check (
    activity_level in ('sedentary', 'light', 'moderate', 'active', 'very_active')
  ),
  goal text not null check (goal in ('cut', 'maintain', 'bulk')),
  -- Cached output of app/domain/macros.py:calculate_macro_targets, refreshed
  -- server-side on profile/weight change. Never computed client-side.
  target_calories integer,
  target_protein_g integer,
  target_carbs_g integer,
  target_fat_g integer,
  -- PRD §3.6 privacy control: opt out of friend leaderboard visibility.
  leaderboard_visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'Extends auth.users with the inputs/outputs of the macro-target calculation and privacy prefs.';

-- =========================================================================
-- weight_logs
-- =========================================================================
create table public.weight_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  weight_kg numeric not null check (weight_kg > 0),
  logged_at timestamptz not null default now()
);

create index weight_logs_user_id_logged_at_idx on public.weight_logs (user_id, logged_at desc);

-- =========================================================================
-- food_items — global, shared database (PRD §3.2)
-- =========================================================================
create table public.food_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  brand text,
  serving_description text not null,
  calories numeric not null check (calories >= 0),
  protein_g numeric not null check (protein_g >= 0),
  carbs_g numeric not null check (carbs_g >= 0),
  fat_g numeric not null check (fat_g >= 0),
  fiber_g numeric,
  sugar_g numeric,
  sodium_mg numeric,
  created_by uuid references auth.users (id) on delete set null,
  verified boolean not null default false,
  created_at timestamptz not null default now()
);

-- Basic duplicate-detection support (PRD §3.2): trigram search on name.
create extension if not exists "pg_trgm";
create index food_items_name_trgm_idx on public.food_items using gin (name gin_trgm_ops);

-- Moderation / report queue (PRD §3.2)
create table public.food_item_reports (
  id uuid primary key default gen_random_uuid(),
  food_item_id uuid not null references public.food_items (id) on delete cascade,
  reported_by uuid not null references auth.users (id) on delete cascade,
  reason text not null,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);

-- =========================================================================
-- food_logs
-- =========================================================================
create table public.food_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  food_item_id uuid not null references public.food_items (id) on delete restrict,
  meal_type text not null check (meal_type in ('breakfast', 'lunch', 'dinner', 'snack')),
  quantity numeric not null default 1 check (quantity > 0),
  logged_at timestamptz not null default now()
);

create index food_logs_user_id_logged_at_idx on public.food_logs (user_id, logged_at desc);

-- =========================================================================
-- water tracking (PRD §3.1)
-- =========================================================================
create table public.glass_sizes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  label text not null,
  volume_ml numeric not null check (volume_ml > 0)
);

create table public.water_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  volume_ml numeric not null check (volume_ml > 0),
  logged_at timestamptz not null default now()
);

create index water_logs_user_id_logged_at_idx on public.water_logs (user_id, logged_at desc);

-- =========================================================================
-- friendships / social comparison (PRD §3.6)
-- =========================================================================
create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users (id) on delete cascade,
  addressee_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint friendships_no_self_friend check (requester_id <> addressee_id),
  constraint friendships_unique_pair unique (requester_id, addressee_id)
);

-- =========================================================================
-- weekly_reports (PRD §3.7)
-- =========================================================================
create table public.weekly_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  week_start date not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, week_start)
);

-- =========================================================================
-- notification_settings (PRD §3.4)
-- =========================================================================
create table public.notification_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  logging_reminders_enabled boolean not null default true,
  reminder_times jsonb not null default '[]'::jsonb,
  streak_warnings_enabled boolean not null default true,
  macro_nudges_enabled boolean not null default true,
  quiet_hours_start time,
  quiet_hours_end time
);

-- =========================================================================
-- chat_history (PRD §3.3)
-- =========================================================================
create table public.chat_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  model_used text,
  created_at timestamptz not null default now()
);

create index chat_history_user_id_created_at_idx on public.chat_history (user_id, created_at desc);

-- =========================================================================
-- activity_logs — synced from Health Connect / HealthKit (PRD §3.9)
-- =========================================================================
create table public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  source text not null check (source in ('health_connect', 'healthkit')),
  activity_date date not null,
  steps integer,
  active_calories numeric,
  workout_minutes numeric,
  synced_at timestamptz not null default now(),
  unique (user_id, source, activity_date)
);
