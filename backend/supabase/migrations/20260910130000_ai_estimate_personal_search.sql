-- Phase 3 correction: an accepted AI-estimated food must become a reusable
-- *personal* food for the user who accepted it (so the same food can be
-- found again later, and reused, without a fresh Gemini call), while still
-- never surfacing as a shared/global food to anyone else.
--
-- The previous version of search_food_items excluded every is_ai_estimate
-- row unconditionally, so a user could never even find their own accepted
-- estimate again. This version instead excludes other users' estimates
-- (and, for an anonymous/omitted caller, all of them) but includes the
-- calling user's own -- and returns is_ai_estimate so callers can tell an
-- estimate-backed match from a verified/custom one and keep that
-- provenance visible rather than silently presenting it as verified
-- database nutrition.

drop function if exists public.search_food_items(text, int);

create function public.search_food_items(
  search text,
  match_limit int default 10,
  requesting_user_id uuid default null
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
  verified boolean,
  created_by uuid,
  is_ai_estimate boolean,
  similarity real
)
language sql
stable
security invoker
as $$
  select
    f.id, f.name, f.brand, f.serving_description,
    f.calories, f.protein_g, f.carbs_g, f.fat_g, f.verified, f.created_by,
    f.is_ai_estimate,
    similarity(f.name, search) as similarity
  from public.food_items f
  where (f.name % search or f.name ilike '%' || search || '%')
    and (f.is_ai_estimate = false or f.created_by = requesting_user_id)
  order by similarity(f.name, search) desc, f.verified desc
  limit match_limit;
$$;

grant execute on function public.search_food_items(text, int, uuid) to authenticated;
