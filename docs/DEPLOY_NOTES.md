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
