# Run, test and deploy

## Environments

| | Frontend | Backend | Database |
|---|---|---|---|
| Production | Vercel `macromate-two.vercel.app` | Render `macromate-vf5z.onrender.com` (free plan, kept warm by UptimeRobot every 5 min) | Supabase (Asia-Pacific) |
| Local / test | `npm run dev` | `uvicorn app.main:app` | a **separate** Supabase test project |

GitHub pushes do **not** deploy. Redeploy Render and Vercel manually.

## Environment variables

Backend (`backend/.env`, never committed): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (legacy JWT key *or* `sb_secret_…`), `SUPABASE_ANON_KEY`, `GEMINI_API_KEY`, `GEMINI_PRIMARY_MODEL`, `GEMINI_FALLBACK_MODEL`, `CORS_ALLOW_ORIGINS` (JSON list). Optional: `AI_MAX_CONCURRENCY`, `AI_CALLS_PER_MINUTE`, `AI_CALLS_PER_DAY`, `CACHE_ENABLED`.

Frontend (`frontend/.env.local`): `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`. The production build fails if `NEXT_PUBLIC_API_URL` is unset.

## Local test project

Local `backend/.env` and `frontend/.env.local` point at the **test** Supabase project; production keys live only in `backend/.env.prod` (gitignored) and are used solely for the read-only food copy.

```bash
cd backend
npx supabase link --project-ref <test-ref> && npx supabase db push        # schema
PYTHONPATH=. uv run python scripts/copy_foods.py                          # read-only copy of production foods
PYTHONPATH=. uv run python scripts/seed_test_user.py                      # users A/B/C + 35 days of data
PYTHONPATH=. uv run python scripts/foods_owner.py detach|attach           # see below
```

Test logins (password `Test@12345`): `tester.a@example.com` (35 days of data), `tester.b@example.com`, `tester.c@example.com` (not onboarded).

Suggestion tests (pytest + e2e) need the shared food pool to contain only their own fixtures → run `foods_owner.py detach` before testing and `attach` before manual demos.

## Tests

- `uv run pytest -m "not live"` — offline, also run by CI (`.github/workflows/ci.yml` with `tsc`, `eslint`, `next build`).
- `uv run pytest -m live` and `npx playwright test` — use real Supabase and Gemini; run them only against the test project.

## Request timing

Every backend response carries `Server-Timing: app;dur=…` and logs `class=ai|data`, so slow AI calls are visibly separate from data calls. `GET /health/deep` checks Supabase reachability and that a Gemini key is configured (without calling Gemini).

## Deploy checklist

1. Back up the database; apply migrations as described in [`PRODUCTION_MIGRATIONS.md`](PRODUCTION_MIGRATIONS.md).
2. Redeploy Render, then Vercel.
3. Smoke test (sign in, log food, past day in the calendar, Coach, Progress, Friends).
4. Roll back with the Vercel/Render "previous deployment" buttons, or tag `baseline-2026-10-27`.
