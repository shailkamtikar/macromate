-- Health Connect (Android) and HealthKit (iOS) are native-OS APIs with no
-- web/browser surface — a PWA cannot call either from JavaScript under any
-- circumstance, regardless of credentials (see backend/app/routers/activity.py
-- module docstring for the full explanation). "manual" is added as a real,
-- usable fallback source so users can still log steps/workouts by hand.
alter table public.activity_logs drop constraint activity_logs_source_check;
alter table public.activity_logs
  add constraint activity_logs_source_check
  check (source in ('health_connect', 'healthkit', 'manual'));
