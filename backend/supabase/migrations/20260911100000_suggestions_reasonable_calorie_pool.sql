-- Third Smart Suggestions fix: suggest_foods_for_remaining previously used
-- `calories <= remaining_calories` as a hard filter, effectively answering
-- "does one food exactly fill what's left" instead of "what's a good thing
-- to eat next". For a large remaining budget (e.g. 2080 kcal / 182g protein)
-- this still passed almost everything, but a user with a *smaller* legit
-- remaining budget than a normal meal (e.g. 300 kcal left) could see zero
-- suggestions purely because every real food in the database happened to be
-- a bit larger than that -- an exact-fit search, not a recommendation.
--
-- The calorie constraint is now a generous "not genuinely unreasonable"
-- ceiling (1.5x the remaining budget, floored at 400 kcal so a small
-- remaining budget doesn't exclude every ordinary meal/snack) instead of an
-- exact-fit cutoff. These constants intentionally mirror
-- REASONABLE_CALORIE_MULTIPLIER / REASONABLE_CALORIE_FLOOR in
-- app/domain/suggestions.py, which is where the actual ranking (protein
-- fit, calorie fit, personalization) now happens -- this RPC's only job is
-- to return a reasonably-sized, privacy-safe candidate *pool* for that
-- domain code to rank. `prioritize_protein` and the SQL-side ORDER BY are
-- removed accordingly: ranking is no longer this function's responsibility.
drop function if exists public.suggest_foods_for_remaining(numeric, numeric, boolean, int);

create or replace function public.suggest_foods_for_remaining(
  remaining_calories numeric,
  pool_limit int default 20
)
returns table (
  id uuid,
  name text,
  brand text,
  serving_description text,
  calories numeric,
  protein_g numeric,
  carbs_g numeric,
  fat_g numeric,
  verified boolean
)
language sql
stable
security invoker
as $$
  select f.id, f.name, f.brand, f.serving_description,
         f.calories, f.protein_g, f.carbs_g, f.fat_g, f.verified
  from public.food_items f
  where f.calories > 0
    and f.calories <= greatest(remaining_calories * 1.5, 400)
    and f.is_ai_estimate = false
    and (f.verified = true or f.created_by is not null)
  order by f.verified desc, f.protein_g / greatest(f.calories, 1) desc
  limit pool_limit;
$$;

grant execute on function public.suggest_foods_for_remaining(numeric, int) to authenticated;
