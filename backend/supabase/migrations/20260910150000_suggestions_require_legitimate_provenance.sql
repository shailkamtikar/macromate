-- Second root-cause fix for "What to Eat Next": excluding is_ai_estimate
-- rows (previous migration) was necessary but not sufficient. Several test
-- suites insert food_items rows directly via the service role, bypassing
-- every real app code path -- these rows have is_ai_estimate = false,
-- verified = false, AND created_by = null, a combination that can never
-- occur through legitimate product usage:
--   * a curated/official food would be verified = true
--   * a real user's own custom food always has created_by set (see
--     POST /api/food-items in app/routers/food.py, which derives
--     created_by from the authenticated JWT -- never left null) and is
--     deliberately globally discoverable (see custom-food.spec.ts)
--   * a personal AI estimate is already excluded by is_ai_estimate = true
-- So (verified = false AND created_by IS NULL) has no legitimate meaning
-- in this schema -- it only happens when something (so far, only test
-- fixtures) inserted a row directly without going through the app. Rather
-- than infer this from the food's *name*, suggestions now require the
-- structural provenance every legitimate food already has: either curated
-- (verified) or owned by a real user (created_by set).
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
    and (f.verified = true or f.created_by is not null)
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
