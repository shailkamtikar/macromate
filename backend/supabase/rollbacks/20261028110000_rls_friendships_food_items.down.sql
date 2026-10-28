-- Restores the previous (permissive) policies.
drop index if exists public.food_items_personal_ai_estimate_unique;
drop trigger if exists food_items_protect_provenance on public.food_items;
drop function if exists public.protect_food_item_provenance();

drop policy if exists "food_items_insert_authenticated" on public.food_items;
drop policy if exists "food_items_update_own_unverified" on public.food_items;
create policy "food_items_insert_authenticated" on public.food_items
  for insert with check (auth.uid() = created_by);
create policy "food_items_update_own_unverified" on public.food_items
  for update using (auth.uid() = created_by and verified = false)
  with check (auth.uid() = created_by);

drop policy if exists "friendships_insert_as_requester" on public.friendships;
drop policy if exists "friendships_update_addressee_responds" on public.friendships;
drop policy if exists "friendships_delete_requester_pending" on public.friendships;
create policy "friendships_insert_as_requester" on public.friendships
  for insert with check (auth.uid() = requester_id);
create policy "friendships_update_participant" on public.friendships
  for update
  using (auth.uid() = requester_id or auth.uid() = addressee_id)
  with check (auth.uid() = requester_id or auth.uid() = addressee_id);
