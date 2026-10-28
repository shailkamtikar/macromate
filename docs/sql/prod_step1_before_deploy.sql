-- MacroMate upgrade, STEP 1 (run BEFORE deploying the new app). Additive and safe with the old app.
-- Paste the whole file into Supabase -> SQL Editor of the PRODUCTION project and click Run.
-- It is one transaction: if anything fails nothing is applied.
begin;

-- ===== 20261028090000_food_logs_user_food_idx.sql =====
-- Speeds up "recent/frequent foods" and personal-history suggestion queries,
-- which group a user's food_logs by food_item_id.
create index if not exists food_logs_user_food_idx
  on public.food_logs (user_id, food_item_id, logged_at desc);

insert into supabase_migrations.schema_migrations (version, name) values ('20261028090000', 'food_logs_user_food_idx') on conflict do nothing;

-- ===== 20261028100000_daily_targets.sql =====
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

insert into supabase_migrations.schema_migrations (version, name) values ('20261028100000', 'daily_targets') on conflict do nothing;

-- ===== 20261028100100_daily_targets_backfill_flag.sql =====
-- Rows that exist when this migration runs were back-filled from each user's
-- CURRENT targets (no earlier history exists), so the calendar must treat the
-- days they cover as approximate. Rows written by the trigger afterwards are
-- real history.
alter table public.daily_targets
  add column if not exists is_backfill boolean not null default false;

update public.daily_targets set is_backfill = true;

insert into supabase_migrations.schema_migrations (version, name) values ('20261028100100', 'daily_targets_backfill_flag') on conflict do nothing;

-- ===== 20261028110000_rls_friendships_food_items.sql =====
-- Closes two trust holes found in the audit. The backend uses the service role
-- for every legitimate write to these tables, so nothing here changes app
-- behaviour; it only stops a user from doing the same writes straight from
-- the browser with their own JWT.
--
-- 1. friendships: either participant could set ANY status, so a requester
--    could approve their own request (gaining leaderboard/activity access),
--    and a new request could be inserted already "accepted".
-- 2. food_items: a user could insert or update their own food with
--    verified = true, which then ranks first in search and suggestions for
--    EVERYONE.

-- ---------------------------------------------------------------- friendships
drop policy if exists "friendships_insert_as_requester" on public.friendships;
drop policy if exists "friendships_update_participant" on public.friendships;

-- A request can only be created as the requester, and only as "pending".
create policy "friendships_insert_as_requester" on public.friendships
  for insert with check (auth.uid() = requester_id and status = 'pending');

-- Only the ADDRESSEE may answer a pending request (accept or decline).
create policy "friendships_update_addressee_responds" on public.friendships
  for update
  using (auth.uid() = addressee_id and status = 'pending')
  with check (auth.uid() = addressee_id and status in ('accepted', 'declined'));

-- The requester may withdraw their own still-pending request.
drop policy if exists "friendships_delete_requester_pending" on public.friendships;
create policy "friendships_delete_requester_pending" on public.friendships
  for delete using (auth.uid() = requester_id and status = 'pending');

-- ---------------------------------------------------------------- food_items
drop policy if exists "food_items_insert_authenticated" on public.food_items;
drop policy if exists "food_items_update_own_unverified" on public.food_items;

create policy "food_items_insert_authenticated" on public.food_items
  for insert with check (
    auth.uid() = created_by
    and verified = false
    and is_ai_estimate = false
  );

create policy "food_items_update_own_unverified" on public.food_items
  for update
  using (auth.uid() = created_by and verified = false and is_ai_estimate = false)
  with check (auth.uid() = created_by and verified = false and is_ai_estimate = false);

-- Belt and braces: even if a policy is later loosened, a client role can
-- never flip these two columns. The backend (service_role) still can.
create or replace function public.protect_food_item_provenance()
returns trigger
language plpgsql
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    if tg_op = 'UPDATE' then
      if new.verified is distinct from old.verified
         or new.is_ai_estimate is distinct from old.is_ai_estimate then
        raise exception 'verified / is_ai_estimate can only be changed by the server'
          using errcode = '42501';
      end if;
    elsif tg_op = 'INSERT' then
      if new.verified is true then
        raise exception 'verified can only be set by the server' using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists food_items_protect_provenance on public.food_items;
create trigger food_items_protect_provenance
  before insert or update on public.food_items
  for each row execute function public.protect_food_item_provenance();

-- ------------------------------------------- reusable AI-estimate foods (BUG-4)
-- get_or_create_personal_food reads then inserts, so two simultaneous logs of
-- the same estimate could create duplicates. One personal AI-estimate food
-- per (owner, case-insensitive name).
--
-- Real data already contains such duplicates, so merge them first: keep the
-- OLDEST row of each group, point every log (and report) at it, delete the
-- rest. Each food_log keeps its own immutable nutrition snapshot, so no
-- logged calories or macros change.
create temp table _food_dupes on commit drop as
select id, keep_id
from (
  select id,
         row_number() over w as rn,
         first_value(id) over w as keep_id
  from public.food_items
  where is_ai_estimate
  window w as (partition by created_by, lower(name) order by created_at, id)
) ranked
where rn > 1;

update public.food_logs l
   set food_item_id = d.keep_id
  from _food_dupes d
 where l.food_item_id = d.id;

update public.food_item_reports r
   set food_item_id = d.keep_id
  from _food_dupes d
 where r.food_item_id = d.id;

delete from public.food_items f
 using _food_dupes d
 where f.id = d.id;

create unique index if not exists food_items_personal_ai_estimate_unique
  on public.food_items (created_by, lower(name))
  where is_ai_estimate;

insert into supabase_migrations.schema_migrations (version, name) values ('20261028110000', 'rls_friendships_food_items') on conflict do nothing;

-- ===== 20261028130000_ai_usage.sql =====
-- Audit trail for AI calls (model, tokens, latency) and the source for the
-- per-user daily limit (app/core/quota.py). Written only by the backend.

create table if not exists public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  route text not null,
  model text,
  prompt_tokens integer,
  output_tokens integer,
  latency_ms integer,
  success boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists ai_usage_user_created_idx
  on public.ai_usage (user_id, created_at desc);

alter table public.ai_usage enable row level security;

create policy "ai_usage_select_own" on public.ai_usage
  for select using (auth.uid() = user_id);

grant select on public.ai_usage to authenticated;
grant all privileges on public.ai_usage to service_role;

insert into supabase_migrations.schema_migrations (version, name) values ('20261028130000', 'ai_usage') on conflict do nothing;

commit;
