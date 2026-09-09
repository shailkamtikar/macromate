-- Row Level Security for every MacroMate table.
-- Default posture: private-by-default, owner-only, with the single
-- deliberate exception being food_items (a shared global database per
-- PRD §3.2). The backend also holds the service-role key for
-- admin/moderation operations that must bypass RLS (e.g. resolving
-- food_item_reports) — those are performed server-side only, never
-- exposed to the client with elevated privileges.

alter table public.profiles enable row level security;
alter table public.weight_logs enable row level security;
alter table public.food_items enable row level security;
alter table public.food_item_reports enable row level security;
alter table public.food_logs enable row level security;
alter table public.glass_sizes enable row level security;
alter table public.water_logs enable row level security;
alter table public.friendships enable row level security;
alter table public.weekly_reports enable row level security;
alter table public.notification_settings enable row level security;
alter table public.chat_history enable row level security;
alter table public.activity_logs enable row level security;

-- ---------------------------------------------------------------------
-- profiles: owner can read/update their own row. Friends visibility for
-- leaderboards (PRD §3.6) is deliberately deferred to a dedicated view
-- built in the friends-feature slice, gated by leaderboard_visible and
-- an accepted friendship — not implemented here to avoid guessing that
-- view's shape prematurely.
-- ---------------------------------------------------------------------
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);

create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- ---------------------------------------------------------------------
-- weight_logs / food_logs / glass_sizes / water_logs / weekly_reports /
-- notification_settings / chat_history / activity_logs: strictly owner-only.
-- ---------------------------------------------------------------------
create policy "weight_logs_owner_all" on public.weight_logs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "food_logs_owner_all" on public.food_logs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "glass_sizes_owner_all" on public.glass_sizes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "water_logs_owner_all" on public.water_logs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "weekly_reports_owner_select" on public.weekly_reports
  for select using (auth.uid() = user_id);
-- weekly_reports are generated server-side (service role), so no client
-- insert/update policy is defined — the client only ever reads them.

create policy "notification_settings_owner_all" on public.notification_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "chat_history_owner_all" on public.chat_history
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "activity_logs_owner_all" on public.activity_logs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- food_items: shared global database. Any authenticated user may read
-- and contribute; only the original submitter may edit their own
-- not-yet-verified entry (verification/edits-after-verify are a
-- moderation action performed server-side with the service role key).
-- ---------------------------------------------------------------------
create policy "food_items_select_authenticated" on public.food_items
  for select using (auth.role() = 'authenticated');

create policy "food_items_insert_authenticated" on public.food_items
  for insert with check (auth.uid() = created_by);

create policy "food_items_update_own_unverified" on public.food_items
  for update
  using (auth.uid() = created_by and verified = false)
  with check (auth.uid() = created_by);

-- ---------------------------------------------------------------------
-- food_item_reports: any authenticated user may file a report and see
-- their own reports; resolving reports is a moderation action performed
-- server-side with the service role key, not exposed here.
-- ---------------------------------------------------------------------
create policy "food_item_reports_insert_authenticated" on public.food_item_reports
  for insert with check (auth.uid() = reported_by);

create policy "food_item_reports_select_own" on public.food_item_reports
  for select using (auth.uid() = reported_by);

-- ---------------------------------------------------------------------
-- friendships: both parties can see the row; only the requester can
-- create it; only the addressee can accept/decline; either party may
-- update status to reflect e.g. cancellation (requester) or response
-- (addressee).
-- ---------------------------------------------------------------------
create policy "friendships_select_participant" on public.friendships
  for select using (auth.uid() = requester_id or auth.uid() = addressee_id);

create policy "friendships_insert_as_requester" on public.friendships
  for insert with check (auth.uid() = requester_id);

create policy "friendships_update_participant" on public.friendships
  for update
  using (auth.uid() = requester_id or auth.uid() = addressee_id)
  with check (auth.uid() = requester_id or auth.uid() = addressee_id);
