-- RLS policies alone are not sufficient: Postgres also requires base
-- table-level GRANTs to the role before RLS is even evaluated. Missing
-- this caused a real "permission denied for table X" failure caught by
-- backend/tests/test_rls.py, not a hypothetical — GRANT is a separate
-- privilege layer from RLS policies, easy to forget by hand.
--
-- Grants below mirror exactly what each table's RLS policies already
-- allow; RLS still does the per-row filtering on top of these.

grant usage on schema public to authenticated;

-- Owner-only tables: full CRUD, rows filtered by policy.
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.weight_logs to authenticated;
grant select, insert, update, delete on public.food_logs to authenticated;
grant select, insert, update, delete on public.glass_sizes to authenticated;
grant select, insert, update, delete on public.water_logs to authenticated;
grant select, insert, update, delete on public.notification_settings to authenticated;
grant select, insert, update, delete on public.chat_history to authenticated;
grant select, insert, update, delete on public.activity_logs to authenticated;
grant select, insert, update, delete on public.friendships to authenticated;

-- weekly_reports: client only ever reads (server generates with the
-- service-role key, which bypasses RLS/grants entirely).
grant select on public.weekly_reports to authenticated;

-- food_items: shared global database — read/insert/update per policy
-- (policy further restricts update to the unverified-own-entry case).
grant select, insert, update on public.food_items to authenticated;

-- food_item_reports: insert-and-read-own only, per policy.
grant select, insert on public.food_item_reports to authenticated;
