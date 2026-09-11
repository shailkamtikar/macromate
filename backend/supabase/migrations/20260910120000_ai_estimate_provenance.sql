-- AI-estimated nutrition provenance (Phase 3): a food_log can now be backed
-- either by a real food_items row (verified or user-custom, as always) or
-- by a one-off food_items row created to hold a Gemini nutrition estimate
-- for a food that had no confident database match. `source` records which,
-- immutably, on the log itself. `is_ai_estimate` marks the backing
-- food_items row so it never pollutes shared search/duplicate-detection
-- results for other users -- it still appears in the estimating user's own
-- recent/frequent foods (which query food_logs directly, not this RPC).

alter table public.food_logs
  add column source text not null default 'database'
    check (source in ('database', 'ai_estimate'));

comment on column public.food_logs.source is
  'Provenance of this log''s nutrition snapshot: "database" for a real food_items row (verified or user-custom, unchanged from before), "ai_estimate" for a Gemini-estimated food with no confident database match. Immutable once logged.';

alter table public.food_items
  add column is_ai_estimate boolean not null default false;

comment on column public.food_items.is_ai_estimate is
  'True for a one-off row created to back a single AI-estimated food log (see POST /api/food-logs with an ai_estimate payload). Excluded from search_food_items so estimates never surface as shared/global search or duplicate-detection results for other users.';

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
  where (f.name % search or f.name ilike '%' || search || '%')
    and f.is_ai_estimate = false
  order by similarity(f.name, search) desc, f.verified desc
  limit match_limit;
$$;

grant execute on function public.search_food_items(text, int) to authenticated;
