-- T02 Birthday Automation — additive digest tables + names-only RPC.
-- SAFE: does not drop birthday_notification_logs (legacy per-person logs remain).
-- SAFE: does not schedule pg_cron and does not modify Lucky Draw / booking tables.
-- Do NOT apply automatically. Review, then paste into Staging SQL editor only.

create table if not exists public.birthday_notification_digests (
  id uuid primary key default gen_random_uuid(),
  birthday_date date not null,
  scheduled_key text not null default 'scheduled',
  status text not null
    check (status in ('pending', 'success', 'partial', 'failure')),
  title text not null,
  body text not null,
  birthday_count integer not null check (birthday_count > 0),
  lock_token uuid,
  locked_at timestamptz,
  sent_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint birthday_notification_digests_date_key_uniq
    unique (birthday_date, scheduled_key)
);

comment on table public.birthday_notification_digests is
  'One combined birthday push per Asia/Kolkata date. Success is not sent again.';

create table if not exists public.birthday_notification_device_deliveries (
  id uuid primary key default gen_random_uuid(),
  digest_id uuid not null
    references public.birthday_notification_digests (id) on delete cascade,
  token_hash text not null,
  status text not null check (status in ('success', 'failure')),
  error_message text,
  updated_at timestamptz not null default now(),
  constraint birthday_notification_device_deliveries_uniq
    unique (digest_id, token_hash)
);

comment on table public.birthday_notification_device_deliveries is
  'Per-device result for a birthday digest. Raw tokens are not stored.';

create index if not exists birthday_notification_digests_date_idx
  on public.birthday_notification_digests (birthday_date desc);

create index if not exists birthday_notification_device_deliveries_digest_idx
  on public.birthday_notification_device_deliveries (digest_id);

alter table public.birthday_notification_digests enable row level security;
alter table public.birthday_notification_device_deliveries enable row level security;

-- Names-only RPC for the Mobile common birthday list popup.
create or replace function public.list_today_birthday_names()
returns table (display_name text)
language sql
stable
security definer
set search_path = ''
as $$
  -- COALESCE/NULLIF are SQL constructs (not schema-callable as pg_catalog.*).
  -- Cast ''::text so empty-string args are not unknown under search_path = ''.
  select COALESCE(
    NULLIF(
      pg_catalog.btrim(
        pg_catalog.concat_ws(
          ' '::text,
          NULLIF(pg_catalog.btrim(COALESCE(u.first_name, ''::text)), ''::text),
          NULLIF(pg_catalog.btrim(COALESCE(u.last_name, ''::text)), ''::text)
        )
      ),
      ''::text
    ),
    'Member'::text
  ) as display_name
  from public.users u
  where public.in_app_is_birthday_today(u.birth_date)
  order by 1, u.id;
$$;

revoke all on function public.list_today_birthday_names() from public;
revoke all on function public.list_today_birthday_names() from anon;
revoke all on function public.list_today_birthday_names() from authenticated;
grant execute on function public.list_today_birthday_names() to authenticated;

comment on function public.list_today_birthday_names() is
  'Authenticated names of members whose birthday is today (Asia/Kolkata). No ids or DOB.';

-- Optional backfill plan (manual, non-destructive):
-- UPDATE public.users
-- SET birth_date = date_of_birth::date
-- WHERE birth_date IS NULL
--   AND date_of_birth IS NOT NULL
--   AND date_of_birth::text ~ '^\d{4}-\d{2}-\d{2}';
-- Review counts first with a SELECT. Never overwrite non-null birth_date.
