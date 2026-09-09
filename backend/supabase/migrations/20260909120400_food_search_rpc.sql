-- Trigram-ranked food search, exposed as a PostgREST RPC so both food
-- search (for logging) and duplicate-detection (before creating a custom
-- food, PRD §3.2) share one ranked-search implementation instead of two
-- divergent ad-hoc queries.
create or replace function public.search_food_items(search text, match_limit int default 10)
returns table (
  id uuid,
  name text,
  brand text,
  serving_description text,
  calories numeric,
  protein_g numeric,
  carbs_g numeric,
  fat_g numeric,
  verified boolean,
  created_by uuid,
  similarity real
)
language sql
stable
security invoker
as $$
  select
    f.id, f.name, f.brand, f.serving_description,
    f.calories, f.protein_g, f.carbs_g, f.fat_g, f.verified, f.created_by,
    similarity(f.name, search) as similarity
  from public.food_items f
  where f.name % search or f.name ilike '%' || search || '%'
  order by similarity(f.name, search) desc, f.verified desc
  limit match_limit;
$$;

grant execute on function public.search_food_items(text, int) to authenticated;
