-- T12 — Member Reviews (canonical backend contract for Admin Web + Mobile V2).
-- SAFE: additive only. Does not modify fraud_reports or trip rating columns.
-- Do NOT apply automatically. Review, then paste into Staging SQL editor only.
-- Never run against Production without explicit approval.

-- ---------------------------------------------------------------------------
-- 1) Tables
-- ---------------------------------------------------------------------------

create table if not exists public.member_reviews (
  id uuid primary key default gen_random_uuid(),
  reviewer_user_id uuid not null references public.users (id) on delete cascade,
  subject_user_id uuid not null references public.users (id) on delete cascade,
  rating smallint not null check (rating >= 1 and rating <= 5),
  review_text text not null check (
    char_length(btrim(review_text)) >= 1
    and char_length(review_text) <= 2000
  ),
  status text not null default 'published'
    check (status in ('published', 'hidden', 'removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  moderated_at timestamptz,
  moderated_by text,
  constraint member_reviews_no_self_review
    check (reviewer_user_id <> subject_user_id)
);

comment on table public.member_reviews is
  'T12 peer member reviews. Public list shows status=published only. Soft-remove via status=removed.';

create unique index if not exists member_reviews_one_active_per_pair_uidx
  on public.member_reviews (reviewer_user_id, subject_user_id)
  where status <> 'removed';

create index if not exists member_reviews_subject_published_created_idx
  on public.member_reviews (subject_user_id, created_at desc)
  where status = 'published';

create index if not exists member_reviews_status_created_idx
  on public.member_reviews (status, created_at desc);

create table if not exists public.member_review_reports (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.member_reviews (id) on delete cascade,
  reporter_user_id uuid not null references public.users (id) on delete cascade,
  reason text not null check (
    char_length(btrim(reason)) >= 1
    and char_length(reason) <= 500
  ),
  status text not null default 'open'
    check (status in ('open', 'resolved', 'dismissed')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text
);

comment on table public.member_review_reports is
  'T12 member reports against published reviews. Admin resolves via service role.';

create index if not exists member_review_reports_review_created_idx
  on public.member_review_reports (review_id, created_at desc);

create index if not exists member_review_reports_status_created_idx
  on public.member_review_reports (status, created_at desc);

-- ---------------------------------------------------------------------------
-- 2) RLS — deny direct client mutation; service_role for Admin APIs
-- ---------------------------------------------------------------------------

alter table public.member_reviews enable row level security;
alter table public.member_review_reports enable row level security;

revoke all on table public.member_reviews from public, anon, authenticated;
revoke all on table public.member_review_reports from public, anon, authenticated;

grant select, insert, update, delete on table public.member_reviews to service_role;
grant select, insert, update, delete on table public.member_review_reports to service_role;

-- No authenticated policies: all member access goes through SECURITY DEFINER RPCs.

-- ---------------------------------------------------------------------------
-- 3) Helpers
-- ---------------------------------------------------------------------------

create or replace function public.t12_current_app_user()
returns table (
  user_id uuid,
  verified boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select u.id, coalesce(u.verified, false)
  from public.users u
  where u.auth_user_id = auth.uid()
  limit 1;
$$;

revoke all on function public.t12_current_app_user() from public;
grant execute on function public.t12_current_app_user() to authenticated;

create or replace function public.t12_normalize_indian_mobile(p_phone text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  digits text;
begin
  digits := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  if length(digits) = 12 and left(digits, 2) = '91' then
    digits := right(digits, 10);
  elsif length(digits) = 11 and left(digits, 1) = '0' then
    digits := right(digits, 10);
  end if;
  if length(digits) = 10 then
    return '+91' || digits;
  end if;
  if coalesce(p_phone, '') ~ '^\+91[0-9]{10}$' then
    return p_phone;
  end if;
  return null;
end;
$$;

revoke all on function public.t12_normalize_indian_mobile(text) from public;
grant execute on function public.t12_normalize_indian_mobile(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4) Member RPCs (Mobile V2 contract — exact names/params)
-- ---------------------------------------------------------------------------

-- 4a) Search registered member by mobile (verified callers only; no phone in result)
create or replace function public.search_member_for_review(p_phone text)
returns table (
  id uuid,
  first_name text,
  last_name text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me_id uuid;
  v_verified boolean;
  v_normalized text;
begin
  if auth.uid() is null then
    return;
  end if;

  select c.user_id, c.verified into v_me_id, v_verified
  from public.t12_current_app_user() c;

  if v_me_id is null or v_verified is not true then
    return;
  end if;

  v_normalized := public.t12_normalize_indian_mobile(p_phone);
  if v_normalized is null then
    return;
  end if;

  return query
  select u.id, u.first_name, u.last_name
  from public.users u
  where u.phone = v_normalized
    and u.id <> v_me_id
  limit 1;
end;
$$;

revoke all on function public.search_member_for_review(text) from public;
grant execute on function public.search_member_for_review(text) to authenticated;

-- 4b) Submit or edit (upsert non-removed) — verified only; no gold check
create or replace function public.submit_member_review(
  p_subject_user_id uuid,
  p_rating integer,
  p_review_text text
)
returns table (
  id uuid,
  reviewer_user_id uuid,
  subject_user_id uuid,
  rating smallint,
  review_text text,
  status text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me_id uuid;
  v_verified boolean;
  v_text text;
  v_existing_id uuid;
  v_subject_exists boolean;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select c.user_id, c.verified into v_me_id, v_verified
  from public.t12_current_app_user() c;

  if v_me_id is null then
    raise exception 'profile required' using errcode = '42501';
  end if;

  if v_verified is not true then
    raise exception 'verified members only' using errcode = '42501';
  end if;

  if p_subject_user_id is null then
    raise exception 'subject required' using errcode = '22023';
  end if;

  if p_subject_user_id = v_me_id then
    raise exception 'self-review is not allowed' using errcode = '23514';
  end if;

  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'rating must be between 1 and 5' using errcode = '23514';
  end if;

  v_text := btrim(coalesce(p_review_text, ''));
  if char_length(v_text) < 1 or char_length(v_text) > 2000 then
    raise exception 'review text length invalid' using errcode = '23514';
  end if;

  select exists (
    select 1 from public.users u where u.id = p_subject_user_id
  ) into v_subject_exists;

  if not v_subject_exists then
    raise exception 'subject not found' using errcode = 'P0002';
  end if;

  select r.id into v_existing_id
  from public.member_reviews r
  where r.reviewer_user_id = v_me_id
    and r.subject_user_id = p_subject_user_id
    and r.status <> 'removed'
  limit 1;

  if v_existing_id is not null then
    update public.member_reviews r
    set
      rating = p_rating::smallint,
      review_text = v_text,
      status = 'published',
      updated_at = now(),
      moderated_at = null,
      moderated_by = null
    where r.id = v_existing_id;
  else
    insert into public.member_reviews (
      reviewer_user_id,
      subject_user_id,
      rating,
      review_text,
      status
    ) values (
      v_me_id,
      p_subject_user_id,
      p_rating::smallint,
      v_text,
      'published'
    )
    returning member_reviews.id into v_existing_id;
  end if;

  return query
  select
    r.id,
    r.reviewer_user_id,
    r.subject_user_id,
    r.rating,
    r.review_text,
    r.status,
    r.created_at,
    r.updated_at
  from public.member_reviews r
  where r.id = v_existing_id;
end;
$$;

revoke all on function public.submit_member_review(uuid, integer, text) from public;
grant execute on function public.submit_member_review(uuid, integer, text) to authenticated;

-- 4c) Own review for subject (edit UX)
create or replace function public.get_my_member_review_for_subject(
  p_subject_user_id uuid
)
returns table (
  id uuid,
  reviewer_user_id uuid,
  subject_user_id uuid,
  rating smallint,
  review_text text,
  status text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me_id uuid;
begin
  if auth.uid() is null or p_subject_user_id is null then
    return;
  end if;

  select c.user_id into v_me_id from public.t12_current_app_user() c;
  if v_me_id is null then
    return;
  end if;

  return query
  select
    r.id,
    r.reviewer_user_id,
    r.subject_user_id,
    r.rating,
    r.review_text,
    r.status,
    r.created_at,
    r.updated_at
  from public.member_reviews r
  where r.reviewer_user_id = v_me_id
    and r.subject_user_id = p_subject_user_id
    and r.status <> 'removed'
  limit 1;
end;
$$;

revoke all on function public.get_my_member_review_for_subject(uuid) from public;
grant execute on function public.get_my_member_review_for_subject(uuid) to authenticated;

-- 4d) Public list — published only (never hidden/removed)
create or replace function public.list_published_member_reviews(
  p_subject_user_id uuid,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  id uuid,
  rating smallint,
  review_text text,
  created_at timestamptz,
  reviewer_first_name text,
  reviewer_last_name text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer;
  v_offset integer;
begin
  if auth.uid() is null or p_subject_user_id is null then
    return;
  end if;

  v_limit := greatest(1, least(coalesce(p_limit, 20), 50));
  v_offset := greatest(0, coalesce(p_offset, 0));

  return query
  select
    r.id,
    r.rating,
    r.review_text,
    r.created_at,
    u.first_name,
    u.last_name
  from public.member_reviews r
  join public.users u on u.id = r.reviewer_user_id
  where r.subject_user_id = p_subject_user_id
    and r.status = 'published'
  order by r.created_at desc
  limit v_limit
  offset v_offset;
end;
$$;

revoke all on function public.list_published_member_reviews(uuid, integer, integer) from public;
grant execute on function public.list_published_member_reviews(uuid, integer, integer) to authenticated;

-- 4e) Report a published review (logged-in; not necessarily verified)
create or replace function public.report_member_review(
  p_review_id uuid,
  p_reason text
)
returns table (
  id uuid,
  review_id uuid,
  status text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me_id uuid;
  v_reason text;
  v_review_status text;
  v_new_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select c.user_id into v_me_id from public.t12_current_app_user() c;
  if v_me_id is null then
    raise exception 'profile required' using errcode = '42501';
  end if;

  if p_review_id is null then
    raise exception 'review required' using errcode = '22023';
  end if;

  v_reason := btrim(coalesce(p_reason, ''));
  if char_length(v_reason) < 1 or char_length(v_reason) > 500 then
    raise exception 'reason length invalid' using errcode = '23514';
  end if;

  select r.status into v_review_status
  from public.member_reviews r
  where r.id = p_review_id;

  if v_review_status is null then
    raise exception 'review not found' using errcode = 'P0002';
  end if;

  if v_review_status <> 'published' then
    raise exception 'only published reviews can be reported' using errcode = '42501';
  end if;

  insert into public.member_review_reports (
    review_id,
    reporter_user_id,
    reason,
    status
  ) values (
    p_review_id,
    v_me_id,
    v_reason,
    'open'
  )
  returning member_review_reports.id into v_new_id;

  return query
  select rep.id, rep.review_id, rep.status, rep.created_at
  from public.member_review_reports rep
  where rep.id = v_new_id;
end;
$$;

revoke all on function public.report_member_review(uuid, text) from public;
grant execute on function public.report_member_review(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5) Admin RBAC seed (service-role Admin APIs enforce reviews.view / .moderate)
-- ---------------------------------------------------------------------------

insert into public.admin_panel_permissions (key, module, description) values
  ('reviews.view', 'reviews', 'View member reviews and review reports'),
  ('reviews.moderate', 'reviews', 'Hide, unhide, remove member reviews and resolve reports')
on conflict (key) do update
set module = excluded.module,
    description = excluded.description;

insert into public.admin_panel_role_permissions (role_id, permission_key)
select r.id, p.key
from public.admin_panel_roles r
cross join (values
  ('reviews.view'),
  ('reviews.moderate')
) as p(key)
where r.slug in ('super_admin', 'admin')
on conflict do nothing;

comment on function public.search_member_for_review(text) is
  'T12: verified member searches another registered user by mobile; returns id+name only.';
comment on function public.submit_member_review(uuid, integer, text) is
  'T12: verified member submits or edits one active review; no gold membership check.';
comment on function public.list_published_member_reviews(uuid, integer, integer) is
  'T12: authenticated list of published reviews only (hidden/removed excluded).';
comment on function public.report_member_review(uuid, text) is
  'T12: authenticated member reports a published review.';
