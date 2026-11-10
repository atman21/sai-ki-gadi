-- T28: Admin Disputed Numbers (review indicator only — never auto-rejects users).
-- Admin Panel accesses via service role. No policies for anon/authenticated.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
create table if not exists public.disputed_numbers (
  id uuid primary key default gen_random_uuid(),
  mobile_number text not null,
  remarks text not null,
  evidence_path text,
  created_by uuid references public.admin_panel_users (id) on delete set null,
  updated_by uuid references public.admin_panel_users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint disputed_numbers_mobile_format
    check (mobile_number ~ '^[6-9][0-9]{9}$'),
  constraint disputed_numbers_remarks_not_blank
    check (length(btrim(remarks)) > 0 and length(remarks) <= 2000)
);

create unique index if not exists disputed_numbers_mobile_number_uidx
  on public.disputed_numbers (mobile_number);

create index if not exists disputed_numbers_created_at_idx
  on public.disputed_numbers (created_at desc);

comment on table public.disputed_numbers is
  'Admin-managed disputed signup mobiles. Review flag only; never auto-blocks accounts.';

comment on column public.disputed_numbers.mobile_number is
  'Canonical 10-digit Indian mobile (same rules as normalizeIndianMobileForReference).';

comment on column public.disputed_numbers.evidence_path is
  'Private storage object path in disputed-number-evidence bucket (not a public URL).';

create or replace function public.set_disputed_numbers_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_disputed_numbers_updated_at on public.disputed_numbers;
create trigger trg_disputed_numbers_updated_at
  before update on public.disputed_numbers
  for each row
  execute function public.set_disputed_numbers_updated_at();

alter table public.disputed_numbers enable row level security;
-- Intentionally no policies for anon/authenticated. Service role bypasses RLS.

revoke all on table public.disputed_numbers from public, anon, authenticated;
grant select, insert, update, delete on table public.disputed_numbers to service_role;

-- ---------------------------------------------------------------------------
-- Private evidence bucket (Admin service-role only)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'disputed-number-evidence',
  'disputed-number-evidence',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- No storage.objects policies for anon/authenticated → clients cannot list/read/write.
-- Admin uploads via service role.

-- ---------------------------------------------------------------------------
-- Admin RBAC permissions
-- ---------------------------------------------------------------------------
insert into public.admin_panel_permissions (key, module, description) values
  ('disputed_numbers.view', 'disputed_numbers', 'View disputed numbers list and evidence'),
  ('disputed_numbers.manage', 'disputed_numbers', 'Add, edit, delete disputed numbers and evidence')
on conflict (key) do update
set module = excluded.module,
    description = excluded.description;

-- Super Admin already has all via cross join; re-sync for new keys.
insert into public.admin_panel_role_permissions (role_id, permission_key)
select r.id, p.key
from public.admin_panel_roles r
cross join public.admin_panel_permissions p
where lower(r.slug) = 'super_admin'
  and p.key in ('disputed_numbers.view', 'disputed_numbers.manage')
on conflict do nothing;

insert into public.admin_panel_role_permissions (role_id, permission_key)
select r.id, p.key
from public.admin_panel_roles r
cross join public.admin_panel_permissions p
where lower(r.slug) = 'admin'
  and p.key in ('disputed_numbers.view', 'disputed_numbers.manage')
on conflict do nothing;

insert into public.admin_panel_role_permissions (role_id, permission_key)
select r.id, p.key
from public.admin_panel_roles r
cross join public.admin_panel_permissions p
where lower(r.slug) = 'manager'
  and p.key in ('disputed_numbers.view', 'disputed_numbers.manage')
on conflict do nothing;

insert into public.admin_panel_role_permissions (role_id, permission_key)
select r.id, p.key
from public.admin_panel_roles r
cross join public.admin_panel_permissions p
where lower(r.slug) = 'operator'
  and p.key = 'disputed_numbers.view'
on conflict do nothing;
