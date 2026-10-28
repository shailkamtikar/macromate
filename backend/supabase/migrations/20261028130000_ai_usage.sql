-- Audit trail for AI calls (model, tokens, latency) and the source for the
-- per-user daily limit (app/core/quota.py). Written only by the backend.

create table if not exists public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  route text not null,
  model text,
  prompt_tokens integer,
  output_tokens integer,
  latency_ms integer,
  success boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists ai_usage_user_created_idx
  on public.ai_usage (user_id, created_at desc);

alter table public.ai_usage enable row level security;

create policy "ai_usage_select_own" on public.ai_usage
  for select using (auth.uid() = user_id);

grant select on public.ai_usage to authenticated;
grant all privileges on public.ai_usage to service_role;
