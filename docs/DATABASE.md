# MacroMate database (Supabase / Postgres)

**Status: applied and verified live** against the project
(`lzvmlqeojdqhirlxthop`). Schema and RLS policies live in
`backend/supabase/migrations/` as plain SQL, applied via
`npx supabase db push` using a `SUPABASE_ACCESS_TOKEN` personal access
token. Derived directly from `docs/MACROMATE_PRD.md` §5.

- `20260909120000_init_schema.sql` — all tables from the PRD's data model,
  every user-owned table referencing `auth.users(id)` (Supabase Auth is the
  only source of truth for identity — nothing here reimplements auth).
- `20260909120100_rls_policies.sql` — RLS enabled on every table. Default
  posture is owner-only; the deliberate exception is `food_items`, which is
  the PRD's shared global food database (any authenticated user can read
  and contribute; only the submitter can edit their own unverified entry).
  Moderation (resolving `food_item_reports`, verifying `food_items`) is a
  server-side operation using the backend's service-role key, which bypasses
  RLS by design — never exposed to the client with elevated privileges.
- `20260909120200_grants.sql` — base Postgres `GRANT`s to the `authenticated`
  role. **Found by a real failing test, not anticipated up front**: RLS
  policies only filter *rows* within privileges a role already has: without
  an explicit `GRANT SELECT/INSERT/...` on a table, Postgres returns
  `permission denied` before RLS is ever evaluated. `backend/tests/test_rls.py`
  caught this (inserts failing with `42501`) the first time the test suite
  ran against the live database; this migration fixes it, mirroring exactly
  what each table's RLS policies already intend to allow.

**Deliberately deferred, not forgotten:** a friends-visible leaderboard view
for `profiles`/logs (PRD §3.6) is not in this migration. Building it now
would mean guessing its exact shape before the friends feature is
implemented; it'll ship as its own migration in that slice, gated by
`profiles.leaderboard_visible` and an `accepted` `friendships` row.

## Verification performed (not just "the push succeeded")

1. `select table_name from information_schema.tables` — all 12 tables present.
2. `select relname, relrowsecurity from pg_class` — RLS enabled on all 12.
3. `select tablename, count(*) from pg_policies group by 1` — 19 policies
   across 12 tables, matching the migration exactly.
4. `backend/tests/test_rls.py` — live functional proof against two real
   throwaway users: user A cannot see user B's `weight_logs`; user B cannot
   insert a row impersonating user A (`user_id` spoofing rejected — the
   "never trust a client-supplied user_id" rule is enforced at the database
   layer, not just in application code); `food_items` are readable by any
   authenticated user but only editable by their unverified creator.

Run `cd backend && uv run pytest` any time to re-verify all of the above
against the live database.

## Applying future migrations

```bash
cd backend
set -a; source .env; set +a; export SUPABASE_ACCESS_TOKEN
npx supabase db push
```

Migration filenames must have a **single unique numeric timestamp prefix**
(`supabase migration new <name>` generates this correctly) — two files
sharing a date-only prefix like `20260909_0001_x.sql` /
`20260909_0002_y.sql` collide on the same derived "version" and only the
first one's bookkeeping row gets recorded (this happened once during
initial setup and was manually reconciled; see git history on this file's
first version for the incident).
