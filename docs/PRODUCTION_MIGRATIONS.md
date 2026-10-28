# Applying the upgrade to production

Everything on branch `macromate-upgrades` was built and tested against a separate **test** Supabase project. **Nothing here has been run against production.** You apply it, in this order. Take a backup first (Supabase dashboard → Database → Backups, or `pg_dump`).

## 0. Order matters

1. **Add the new migrations that are safe with the old app** (step 1 below).
2. **Deploy the new backend (Render) and frontend (Vercel).**
3. **Only then** run the lock-down migration (step 3). Running it earlier breaks the *old* frontend, which still writes profiles and weight logs straight from the browser.

## 1. Migrations safe to run before the deploy (additive)

Run in file order from `backend/supabase/migrations/`:

| File | What it does | Rollback |
|---|---|---|
| `20261028090000_food_logs_user_food_idx.sql` | Index for per-user food lookups | `rollbacks/…food_logs_user_food_idx.down.sql` |
| `20261028100000_daily_targets.sql` | `daily_targets` table + trigger that records every target change; back-fills one row per existing user from their **current** targets | `rollbacks/…daily_targets.down.sql` |
| `20261028100100_daily_targets_backfill_flag.sql` | Marks the back-filled rows as approximate | (covered by the one above) |
| `20261028110000_rls_friendships_food_items.sql` | Only the *addressee* can accept a friend request; users can no longer create or promote "verified" foods; unique personal AI-estimate foods | `rollbacks/…rls_friendships_food_items.down.sql` |
| `20261028130000_ai_usage.sql` | `ai_usage` audit table used by the per-user AI limits | `rollbacks/…ai_usage.down.sql` |

Apply with the Supabase CLI against the **production** project (link first: `npx supabase link --project-ref <prod-ref>`), or paste each file into the SQL editor.

> If `daily_targets` already contains rows when you run `…100100`, they are all treated as back-filled. Run both files back-to-back.

## 2. Deploy

- **Render (backend):** deploy branch `macromate-upgrades` (or merge to `main` and redeploy). No new environment variables are *required*. Optional tuning (defaults shown): `AI_MAX_CONCURRENCY=4`, `AI_CALLS_PER_MINUTE=8`, `AI_CALLS_PER_DAY=200`. Confirm `CORS_ALLOW_ORIGINS=["https://macromate-two.vercel.app"]`.
- **Vercel (frontend):** redeploy. Required variables already exist (`NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`); the build now **fails** if `NEXT_PUBLIC_API_URL` is missing.
- The backend works with both Supabase key formats (legacy JWT keys and the new `sb_secret_…` keys), so your current production keys keep working.

Smoke test after deploy: sign up/in → onboarding → log food → open a past day in the calendar → ask the Coach something → Progress → Friends.

## 3. Lock-down migration (run **after** the deploy works)

| File | What it does | Rollback |
|---|---|---|
| `20261028120000_lock_client_profile_and_weight_writes.sql` | Browsers can no longer write profile targets or weight logs directly (only `timezone` stays writable). The backend (`PUT /api/profile`, `POST /api/weight-logs`) is the only writer. | `rollbacks/…lock_client_profile_and_weight_writes.down.sql` |

Quick check afterwards: edit your profile in the app (must still save), then try the same from the browser console with the anon key — it must be refused.

## 4. Verify in production (read-only)

```sql
select tablename, policyname from pg_policies where tablename in ('friendships','food_items','daily_targets','ai_usage');
select count(*) from public.daily_targets;          -- one row per onboarded user
select has_column_privilege('authenticated','public.profiles','target_calories','UPDATE');  -- false
```

## 5. Roll back

- **App only:** Vercel → Deployments → previous → *Promote*; Render → Deploys → previous → *Rollback*. (Roll the app back *before* rolling back step 3.)
- **Database:** run the matching `rollbacks/*.down.sql`, newest first.
- **Whole branch:** the pre-upgrade state is git tag `baseline-2026-10-27`.

## 6. Known limits

- AI limits and the suggestions cache live in memory per backend instance (Render free = one instance, so exact).
- Days before the target history started show your *current* targets, with a small "approximate" note in the app.
