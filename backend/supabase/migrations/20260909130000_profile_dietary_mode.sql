-- Dietary mode for AI diet generation (PRD §3/9) and future food filtering.
alter table public.profiles
  add column dietary_mode text not null default 'non_vegetarian'
  check (dietary_mode in ('vegetarian', 'non_vegetarian', 'egg_inclusive'));
