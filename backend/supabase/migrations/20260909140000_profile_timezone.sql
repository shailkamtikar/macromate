-- "Today"/"this week" must be evaluated in the user's local calendar day,
-- not the server's UTC day, or logs made near local midnight silently land
-- on the wrong day for anyone outside UTC. Stores an IANA timezone name
-- (e.g. "Asia/Kolkata"), captured client-side via
-- Intl.DateTimeFormat().resolvedOptions().timeZone at onboarding.
alter table public.profiles
  add column if not exists timezone text not null default 'UTC';
