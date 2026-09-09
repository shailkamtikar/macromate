-- Server-side constraint search for "what fits my remaining macros"
-- (PRD §3.5) — a pure database query, not AI. Returns foods that fit
-- within the remaining calorie/protein budget, prioritizing protein
-- density when the user is short on protein (the common case this
-- feature exists for) and calorie-fit otherwise.
create or replace function public.suggest_foods_for_remaining(
  remaining_calories numeric,
  remaining_protein_g numeric,
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
    -- Protein-per-calorie density first (helps close a protein gap
    -- without blowing the calorie budget), then verified foods, then
    -- closer-to-using-the-full-remaining-budget.
    (f.protein_g / greatest(f.calories, 1)) desc,
    f.verified desc,
    f.calories desc
  limit match_limit;
$$;

grant execute on function public.suggest_foods_for_remaining(numeric, numeric, int) to authenticated;
