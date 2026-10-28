-- Rows that exist when this migration runs were back-filled from each user's
-- CURRENT targets (no earlier history exists), so the calendar must treat the
-- days they cover as approximate. Rows written by the trigger afterwards are
-- real history.
alter table public.daily_targets
  add column if not exists is_backfill boolean not null default false;

update public.daily_targets set is_backfill = true;
