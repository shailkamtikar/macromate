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
