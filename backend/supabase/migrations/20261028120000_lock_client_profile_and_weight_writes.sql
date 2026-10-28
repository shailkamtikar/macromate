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
