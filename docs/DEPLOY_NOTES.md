# Deploy notes

- Frontend: https://macromate-two.vercel.app (Vercel, Asia-Pacific)
- Backend: https://macromate-vf5z.onrender.com (Render Free, Asia-Pacific; UptimeRobot pings `/health` every 5 min)
- Database/Auth: Supabase (Asia-Pacific)
- Pushing to GitHub does not auto-deploy; redeploy manually.
- Rollback baseline: git tag `baseline-2026-10-27` (state of `main` before the upgrade branch).

## Local environments

- `backend/.env.prod` (gitignored): production keys. Used only for the read-only food copy.
- `backend/.env` (gitignored): TEST Supabase project. Used by local backend and tests.
- `frontend/.env.local` (gitignored): TEST Supabase project + `NEXT_PUBLIC_API_URL=http://localhost:8000`.

## Test project

- Supabase TEST project ref: `obpzqvoaiygskpqxicce` (keys live only in the gitignored `backend/.env` and `frontend/.env.local`).
- It uses the new `sb_publishable_` / `sb_secret_` key format. `app/core/supabase_admin.py::service_headers` sends those in the `apikey` header only (legacy JWT keys still use `apikey` + `Authorization: Bearer`), so production keeps working unchanged.
- Seed: `cd backend && PYTHONPATH=. uv run python scripts/copy_foods.py` (read-only GET on production, writes to test) then `PYTHONPATH=. uv run python scripts/seed_test_user.py`.
- Test logins (password `Test@12345`): tester.a@example.com (35 days of data), tester.b@example.com, tester.c@example.com (not onboarded).
- Known data-dependent test: `test_suggestions_prioritize_protein_when_the_gap_is_real` assumes few protein-dense foods in the shared pool; with the copied food data another food can outrank the fixture food.
