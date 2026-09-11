-- Root-cause fix: suggest_foods_for_remaining ("What to Eat Next") never
-- excluded is_ai_estimate rows, unlike search_food_items (which has excluded
-- other users' AI estimates since 20260910120000/20260910130000 for exactly
-- this reason). A personal, one-off AI-estimate food_items row -- created to
-- back a single logged estimate, often with a tiny per-gram serving (e.g.
-- "1g paneer" -> ~1 kcal) -- was therefore eligible to be suggested to ANY
-- user: it easily fits inside a large remaining-calorie budget, so it kept
-- surfacing as a "suggestion" showing its raw estimate name and effectively
-- zero nutrition after rounding. Suggestions are a shared/global discovery
-- feature like search, not a personal-reuse feature, so estimates are
-- excluded outright here (not scoped back in for their own creator).
drop function if exists public.suggest_foods_for_remaining(numeric, numeric, boolean, int);

create or replace function public.suggest_foods_for_remaining(
  remaining_calories numeric,
  remaining_protein_g numeric,
  prioritize_protein boolean default true,
  match_limit int default 3
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
  where f.calories <= greatest(remaining_calories, 1)
    and f.calories > 0
    and f.is_ai_estimate = false
  order by
    -- Lead with protein-per-calorie density only when the caller says
    -- protein is genuinely still needed today; otherwise this expression
    -- is null for every row, so the ranking falls through to the next key
    -- (verified foods, then how much of the remaining calorie budget the
    -- food actually uses).
    case when prioritize_protein then (f.protein_g / greatest(f.calories, 1)) end desc nulls last,
    f.verified desc,
    f.calories desc
  limit match_limit;
$$;

grant execute on function public.suggest_foods_for_remaining(numeric, numeric, boolean, int) to authenticated;
