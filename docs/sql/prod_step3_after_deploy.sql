-- MacroMate upgrade, STEP 3 (run AFTER the new backend and frontend are deployed and working).
-- Stops browsers from writing profile targets / weight logs directly; the backend is the only writer.
begin;

-- ===== 20261028120000_lock_client_profile_and_weight_writes.sql =====
-- Profile targets and weight history are now written only by the backend
-- (PUT /api/profile, POST /api/weight-logs), which recomputes targets with
-- the deterministic engine. Clients keep read access, plus the ability to
-- sync their own timezone.
--
-- ORDER MATTERS in production: deploy the backend + frontend that use the new
-- endpoints FIRST, then run this migration. Running it earlier breaks the old
-- frontend's direct profile/weight writes.

revoke insert, update, delete on public.profiles from authenticated;
grant update (timezone) on public.profiles to authenticated;

revoke insert, update, delete on public.weight_logs from authenticated;

insert into supabase_migrations.schema_migrations (version, name) values ('20261028120000', 'lock_client_profile_and_weight_writes') on conflict do nothing;

commit;
