-- Discovered live (not anticipated): tables created via a hand-written
-- migration don't automatically get the privilege grants Supabase's own
-- table editor normally applies. service_role bypasses RLS but still
-- needs base object privileges — without this, even our own backend
-- (which authenticates as service_role) gets "permission denied".
grant usage on schema public to service_role;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- Ensure this also applies to anything created later without a manual
-- grant, so this class of bug can't recur.
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;
