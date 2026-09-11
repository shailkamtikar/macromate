-- Refines suggest_foods_for_remaining (PRD §3.5). Previously this always
-- ranked candidate foods by protein-per-calorie density first, regardless
-- of whether the user actually still needed protein that day — so once a
-- user's protein target was already met, the "what's left" suggestions
-- kept recommending protein-dense foods purely because that column was
-- always the primary sort key, ignoring the user's real remaining macro
-- situation. `prioritize_protein` lets the caller (the /api/suggestions
-- route, which knows the real remaining-vs-target protein gap) turn that
-- ranking off; when it's false the function falls back to preferring
-- verified foods and better calorie-budget fit instead.
drop function if exists public.suggest_foods_for_remaining(numeric, numeric, int);

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
