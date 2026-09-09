# MacroMate database (Supabase / Postgres)

Schema and RLS policies live in `backend/supabase/migrations/` as plain SQL,
following the Supabase CLI migration convention (`supabase db push` applies
every file in order). Derived directly from `docs/MACROMATE_PRD.md` §5.

- `20260909_0001_init_schema.sql` — all tables from the PRD's data model,
  every user-owned table referencing `auth.users(id)` (Supabase Auth is the
  only source of truth for identity — nothing here reimplements auth).
- `20260909_0002_rls_policies.sql` — RLS enabled on every table. Default
  posture is owner-only; the deliberate exception is `food_items`, which is
  the PRD's shared global food database (any authenticated user can read
  and contribute; only the submitter can edit their own unverified entry).
  Moderation (resolving `food_item_reports`, verifying `food_items`) is a
  server-side operation using the backend's service-role key, which bypasses
  RLS by design — never exposed to the client with elevated privileges.

**Deliberately deferred, not forgotten:** a friends-visible leaderboard view
for `profiles`/logs (PRD §3.6) is not in this migration. Building it now
would mean guessing its exact shape before the friends feature is
implemented; it'll ship as its own migration in that slice, gated by
`profiles.leaderboard_visible` and an `accepted` `friendships` row.

## Applying the migration — blocked on a credential

The service-role key that's configured (`backend/.env` /
`SUPABASE_SERVICE_ROLE_KEY`) authenticates the **PostgREST and Auth HTTP
APIs**, not raw SQL/DDL — confirmed live: `GET /rest/v1/` and
`GET /auth/v1/health` both return 200 with that key. Running `CREATE TABLE`
requires one of:

1. **A Supabase personal access token** (Dashboard → Account → Access
   Tokens), used as `SUPABASE_ACCESS_TOKEN` so the CLI can
   `supabase link --project-ref lzvmlqeojdqhirlxthop` and
   `supabase db push`, **or**
2. **The project's Postgres database password** (Dashboard → Project
   Settings → Database → Connection string / Reset database password),
   used as `supabase db push --db-url postgresql://postgres:<password>@db.lzvmlqeojdqhirlxthop.supabase.co:5432/postgres`.

Either credential is enough — only one is needed. Once one is in
`backend/.env`, applying the migration is a single command:

```bash
cd backend
npx supabase db push   # after supabase link, if using the access-token path
# or
npx supabase db push --db-url "$SUPABASE_DB_URL"   # if using the db-password path
```

This SQL has not yet run against the live database — it's been reviewed by
hand but not executed, since neither credential above was provided.
