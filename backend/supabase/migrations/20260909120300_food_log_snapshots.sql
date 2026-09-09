-- Food logs must preserve the nutrition values used at logging time so a
-- later edit to a food_items row never silently rewrites historical logs
-- (explicit product requirement). Snapshot columns are populated by the
-- backend at insert time from food_items * quantity — never recomputed
-- from the live food_items row afterward.

alter table public.food_logs
  add column calories numeric not null default 0,
  add column protein_g numeric not null default 0,
  add column carbs_g numeric not null default 0,
  add column fat_g numeric not null default 0;

alter table public.food_logs alter column calories drop default;
alter table public.food_logs alter column protein_g drop default;
alter table public.food_logs alter column carbs_g drop default;
alter table public.food_logs alter column fat_g drop default;

comment on column public.food_logs.calories is
  'Snapshot at logging time (food_items nutrition * quantity), immutable afterward.';
