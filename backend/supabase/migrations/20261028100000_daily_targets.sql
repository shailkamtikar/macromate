-- Per-day target history for the calendar: a past day must show the targets
-- that were active THEN, not whatever the profile says now.
--
-- One row per (user, local date on which the targets changed). A day's
-- targets are the row with the greatest effective_from <= that day. Rows are
-- written only by the trigger below (and the service role), never by clients,
-- so the history can't be rewritten from the browser.

create table if not exists public.daily_targets (
  user_id uuid not null references auth.users (id) on delete cascade,
  effective_from date not null,
  target_calories integer not null,
  target_protein_g integer,
  target_carbs_g integer,
  target_fat_g integer,
  water_goal_ml integer,
  created_at timestamptz not null default now(),
  primary key (user_id, effective_from)
);

alter table public.daily_targets enable row level security;

create policy "daily_targets_select_own" on public.daily_targets
  for select using (auth.uid() = user_id);

grant select on public.daily_targets to authenticated;
grant all privileges on public.daily_targets to service_role;

create or replace function public.snapshot_profile_targets()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  local_date date;
begin
  if new.target_calories is null then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.target_calories is not distinct from old.target_calories
     and new.target_protein_g is not distinct from old.target_protein_g
     and new.target_carbs_g is not distinct from old.target_carbs_g
     and new.target_fat_g is not distinct from old.target_fat_g
     and new.water_goal_ml is not distinct from old.water_goal_ml then
    return new;
  end if;

  -- "Today" in the user's own timezone, so a change made at 00:30 IST counts
  -- for that local day, not the previous UTC day.
  begin
    local_date := (now() at time zone coalesce(new.timezone, 'UTC'))::date;
  exception when others then
    local_date := (now() at time zone 'UTC')::date;
  end;

  insert into public.daily_targets as d
    (user_id, effective_from, target_calories, target_protein_g,
     target_carbs_g, target_fat_g, water_goal_ml)
  values
    (new.id, local_date, new.target_calories, new.target_protein_g,
     new.target_carbs_g, new.target_fat_g, new.water_goal_ml)
  on conflict (user_id, effective_from) do update set
    target_calories = excluded.target_calories,
    target_protein_g = excluded.target_protein_g,
    target_carbs_g = excluded.target_carbs_g,
    target_fat_g = excluded.target_fat_g,
    water_goal_ml = excluded.water_goal_ml;

  return new;
end;
$$;

drop trigger if exists profiles_snapshot_targets on public.profiles;
create trigger profiles_snapshot_targets
  after insert or update on public.profiles
  for each row execute function public.snapshot_profile_targets();

-- Backfill: no earlier history exists, so each existing user starts with
-- their CURRENT targets, effective from the day their profile was created.
insert into public.daily_targets
  (user_id, effective_from, target_calories, target_protein_g,
   target_carbs_g, target_fat_g, water_goal_ml)
select p.id, p.created_at::date, p.target_calories, p.target_protein_g,
       p.target_carbs_g, p.target_fat_g, p.water_goal_ml
from public.profiles p
where p.target_calories is not null
on conflict (user_id, effective_from) do nothing;
