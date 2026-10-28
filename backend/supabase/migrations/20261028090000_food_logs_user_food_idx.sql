-- Speeds up "recent/frequent foods" and personal-history suggestion queries,
-- which group a user's food_logs by food_item_id.
create index if not exists food_logs_user_food_idx
  on public.food_logs (user_id, food_item_id, logged_at desc);
