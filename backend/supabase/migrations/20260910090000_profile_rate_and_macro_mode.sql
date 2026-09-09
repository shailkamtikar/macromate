-- Onboarding batch 1: the weight-loss/gain rate and automatic-vs-custom
-- macro choice must be persisted and reloaded correctly (not just their
-- resulting target_calories/target_protein_g/etc, which already existed),
-- so a returning user's Profile screen reflects what they actually chose.
alter table public.profiles
  add column if not exists rate_kg_per_week numeric check (rate_kg_per_week is null or rate_kg_per_week > 0),
  add column if not exists macro_mode text not null default 'automatic'
    check (macro_mode in ('automatic', 'custom'));
