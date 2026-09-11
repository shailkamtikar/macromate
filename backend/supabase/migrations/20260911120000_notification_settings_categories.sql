-- Final feature sprint: adds the master on/off switch and the friend-meal-
-- activity category to notification_settings. Both default true so an
-- existing row (created before this migration) keeps behaving exactly as
-- it already did -- notifications_enabled=true is a no-op gate for anyone
-- who never touched their settings, and friend_activity_enabled=true just
-- turns on the one previously-nonexistent category.
alter table public.notification_settings
  add column notifications_enabled boolean not null default true,
  add column friend_activity_enabled boolean not null default true;

comment on column public.notification_settings.notifications_enabled is
  'Master switch. When false, no notification category fires regardless of its own per-category flag.';
comment on column public.notification_settings.friend_activity_enabled is
  'Whether a friend logging a meal surfaces an in-app/browser notification for this user (see GET /api/friends/activity, which already groups multiple foods in one meal into a single item -- this flag only gates whether that item also becomes a notification).';
