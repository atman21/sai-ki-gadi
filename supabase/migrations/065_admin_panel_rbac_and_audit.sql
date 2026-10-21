-- Admin Panel RBAC + Audit Logs (Next.js Admin only; service_role access).
-- Additive and backward-compatible. Does not alter customer auth.

-- ---------------------------------------------------------------------------
-- 1) Admin panel users (separate from public.users / customer accounts)
-- ---------------------------------------------------------------------------

create table if not exists public.admin_panel_users (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  password_hash text not null,
  display_name text not null,
  is_active boolean not null default true,
  is_super_admin boolean not null default false,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.admin_panel_users (id) on delete set null,
  constraint admin_panel_users_username_not_blank
    check (length(trim(username)) > 0),
  constraint admin_panel_users_display_name_not_blank
    check (length(trim(display_name)) > 0)
);

create unique index if not exists admin_panel_users_username_uidx
  on public.admin_panel_users (lower(trim(username)));

create index if not exists admin_panel_users_active_idx
  on public.admin_panel_users (is_active)
  where is_active = true;

drop trigger if exists admin_panel_users_set_updated_at on public.admin_panel_users;
create trigger admin_panel_users_set_updated_at
before update on public.admin_panel_users
for each row execute procedure public.update_updated_at_column();

alter table public.admin_panel_users enable row level security;
-- No policies for anon/authenticated → service_role only.

-- ---------------------------------------------------------------------------
-- 2) Roles
-- ---------------------------------------------------------------------------

create table if not exists public.admin_panel_roles (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  name text not null,
  description text,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint admin_panel_roles_slug_not_blank
    check (length(trim(slug)) > 0)
);

create unique index if not exists admin_panel_roles_slug_uidx
  on public.admin_panel_roles (lower(trim(slug)));

drop trigger if exists admin_panel_roles_set_updated_at on public.admin_panel_roles;
create trigger admin_panel_roles_set_updated_at
before update on public.admin_panel_roles
for each row execute procedure public.update_updated_at_column();

alter table public.admin_panel_roles enable row level security;

-- ---------------------------------------------------------------------------
-- 3) Permission catalog
-- ---------------------------------------------------------------------------

create table if not exists public.admin_panel_permissions (
  key text primary key,
  module text not null,
  description text not null,
  created_at timestamptz not null default now()
);

alter table public.admin_panel_permissions enable row level security;

-- ---------------------------------------------------------------------------
-- 4) Role ↔ permission
-- ---------------------------------------------------------------------------

create table if not exists public.admin_panel_role_permissions (
  role_id uuid not null references public.admin_panel_roles (id) on delete cascade,
  permission_key text not null references public.admin_panel_permissions (key) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (role_id, permission_key)
);

alter table public.admin_panel_role_permissions enable row level security;

-- ---------------------------------------------------------------------------
-- 5) User ↔ role
-- ---------------------------------------------------------------------------

create table if not exists public.admin_panel_user_roles (
  user_id uuid not null references public.admin_panel_users (id) on delete cascade,
  role_id uuid not null references public.admin_panel_roles (id) on delete cascade,
  created_at timestamptz not null default now(),
  assigned_by uuid references public.admin_panel_users (id) on delete set null,
  primary key (user_id, role_id)
);

create index if not exists admin_panel_user_roles_role_idx
  on public.admin_panel_user_roles (role_id);

alter table public.admin_panel_user_roles enable row level security;

-- ---------------------------------------------------------------------------
-- 6) Direct user permission overrides (grant / deny)
-- Deny overrides role grant. Explicit grant adds permission beyond roles.
-- ---------------------------------------------------------------------------

create table if not exists public.admin_panel_user_permissions (
  user_id uuid not null references public.admin_panel_users (id) on delete cascade,
  permission_key text not null references public.admin_panel_permissions (key) on delete cascade,
  effect text not null check (effect in ('grant', 'deny')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  assigned_by uuid references public.admin_panel_users (id) on delete set null,
  primary key (user_id, permission_key)
);

drop trigger if exists admin_panel_user_permissions_set_updated_at
  on public.admin_panel_user_permissions;
create trigger admin_panel_user_permissions_set_updated_at
before update on public.admin_panel_user_permissions
for each row execute procedure public.update_updated_at_column();

alter table public.admin_panel_user_permissions enable row level security;

-- ---------------------------------------------------------------------------
-- 7) Audit logs (append-only for app roles; no update/delete policies)
-- ---------------------------------------------------------------------------

create table if not exists public.admin_panel_audit_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  actor_id uuid references public.admin_panel_users (id) on delete set null,
  actor_username text,
  actor_display_name text,
  actor_is_super_admin boolean,
  action text not null,
  module text not null,
  resource_type text,
  resource_id text,
  description text not null,
  success boolean not null default true,
  changed_fields text[] not null default '{}',
  before_data jsonb,
  after_data jsonb,
  metadata jsonb not null default '{}'::jsonb,
  request_id text,
  ip_address text,
  user_agent text
);

create index if not exists admin_panel_audit_logs_created_idx
  on public.admin_panel_audit_logs (created_at desc);

create index if not exists admin_panel_audit_logs_actor_idx
  on public.admin_panel_audit_logs (actor_id, created_at desc);

create index if not exists admin_panel_audit_logs_action_idx
  on public.admin_panel_audit_logs (action, created_at desc);

create index if not exists admin_panel_audit_logs_module_idx
  on public.admin_panel_audit_logs (module, created_at desc);

create index if not exists admin_panel_audit_logs_resource_idx
  on public.admin_panel_audit_logs (resource_type, resource_id);

alter table public.admin_panel_audit_logs enable row level security;

-- ---------------------------------------------------------------------------
-- 8) Member approval attribution columns on public.users
-- ---------------------------------------------------------------------------

alter table public.users
  add column if not exists verification_reviewed_by text;

alter table public.users
  add column if not exists verification_reviewed_at timestamptz;

alter table public.users
  add column if not exists verification_reviewed_by_admin_id uuid;

comment on column public.users.verification_reviewed_by is
  'Admin panel username (or display) who last approved/rejected verification.';
comment on column public.users.verification_reviewed_at is
  'When verification was last approved/rejected by an admin panel user.';
comment on column public.users.verification_reviewed_by_admin_id is
  'admin_panel_users.id of the actor when known; null for legacy/system.';

-- ---------------------------------------------------------------------------
-- 9) Seed permission catalog (idempotent)
-- ---------------------------------------------------------------------------

insert into public.admin_panel_permissions (key, module, description) values
  ('dashboard.view', 'dashboard', 'View admin dashboard overview'),
  ('members.view', 'members', 'View members and verification queues'),
  ('members.edit', 'members', 'Edit member profile fields (e.g. birth date)'),
  ('members.approve', 'members', 'Approve member verification'),
  ('members.reject', 'members', 'Reject member verification'),
  ('members.wallet', 'members', 'View and manage member wallets'),
  ('members.membership', 'members', 'View and manage memberships'),
  ('vehicles.view', 'vehicles', 'View car verification queue'),
  ('vehicles.approve', 'vehicles', 'Approve vehicle verification'),
  ('vehicles.reject', 'vehicles', 'Reject vehicle verification'),
  ('profile_changes.view', 'profile_changes', 'View profile change requests'),
  ('profile_changes.approve', 'profile_changes', 'Approve profile change requests'),
  ('profile_changes.reject', 'profile_changes', 'Reject profile change requests'),
  ('requirements.view', 'requirements', 'View requirements feed'),
  ('exchanges.view', 'exchanges', 'View exchange listings'),
  ('fraud.view', 'fraud', 'View fraud reports'),
  ('fraud.manage', 'fraud', 'Update fraud report status'),
  ('cities.view', 'cities', 'View cities'),
  ('cities.manage', 'cities', 'Create/update/delete cities'),
  ('sliders.view', 'sliders', 'View sliders'),
  ('sliders.manage', 'sliders', 'Manage sliders'),
  ('winners.view', 'winners', 'View winners'),
  ('winners.manage', 'winners', 'Manage winners'),
  ('minimum_fares.view', 'minimum_fares', 'View minimum fare rules'),
  ('minimum_fares.manage', 'minimum_fares', 'Manage minimum fare rules'),
  ('fare_overrides.view', 'fare_overrides', 'View fare override requests and active overrides'),
  ('fare_overrides.manage', 'fare_overrides', 'Approve/reject/revoke fare overrides'),
  ('priority.view', 'priority', 'View priority timeline settings'),
  ('priority.manage', 'priority', 'Update priority timeline settings'),
  ('about.view', 'about', 'View About Us content'),
  ('about.manage', 'about', 'Edit About Us content'),
  ('announcements.view', 'announcements', 'View in-app announcements'),
  ('announcements.manage', 'announcements', 'Manage in-app announcements'),
  ('birthday.view', 'birthday', 'View birthday notification settings'),
  ('birthday.manage', 'birthday', 'Manage birthday notifications'),
  ('lucky_draw.view', 'lucky_draw', 'View lucky draw notification settings'),
  ('lucky_draw.manage', 'lucky_draw', 'Manage lucky draw notifications'),
  ('admins.view', 'administration', 'View admin panel users'),
  ('admins.manage', 'administration', 'Create/update/deactivate admin panel users'),
  ('roles.manage', 'administration', 'Manage roles and role permissions'),
  ('permissions.assign', 'administration', 'Assign roles and permission overrides'),
  ('audit_logs.view', 'audit', 'View admin audit logs'),
  ('settings.view', 'settings', 'View admin settings')
on conflict (key) do update
set module = excluded.module,
    description = excluded.description;

-- ---------------------------------------------------------------------------
-- 10) Seed system roles
-- ---------------------------------------------------------------------------

insert into public.admin_panel_roles (slug, name, description, is_system)
values
  ('super_admin', 'Super Admin', 'Full access including permission management and audit logs', true),
  ('admin', 'Admin', 'Broad operational access without permission administration', true),
  ('manager', 'Manager', 'Member, verification, and content operations', true),
  ('operator', 'Operator', 'Read-mostly with limited approval actions', true)
on conflict do nothing;

-- Ensure system roles exist even if unique index conflict path differs
insert into public.admin_panel_roles (slug, name, description, is_system)
select v.slug, v.name, v.description, true
from (values
  ('super_admin', 'Super Admin', 'Full access including permission management and audit logs'),
  ('admin', 'Admin', 'Broad operational access without permission administration'),
  ('manager', 'Manager', 'Member, verification, and content operations'),
  ('operator', 'Operator', 'Read-mostly with limited approval actions')
) as v(slug, name, description)
where not exists (
  select 1 from public.admin_panel_roles r where lower(r.slug) = lower(v.slug)
);

-- Super Admin role: all permissions
insert into public.admin_panel_role_permissions (role_id, permission_key)
select r.id, p.key
from public.admin_panel_roles r
cross join public.admin_panel_permissions p
where lower(r.slug) = 'super_admin'
on conflict do nothing;

-- Admin role: everything except admins.manage / roles.manage / permissions.assign
insert into public.admin_panel_role_permissions (role_id, permission_key)
select r.id, p.key
from public.admin_panel_roles r
cross join public.admin_panel_permissions p
where lower(r.slug) = 'admin'
  and p.key not in ('admins.manage', 'roles.manage', 'permissions.assign')
on conflict do nothing;

-- Manager role
insert into public.admin_panel_role_permissions (role_id, permission_key)
select r.id, p.key
from public.admin_panel_roles r
cross join public.admin_panel_permissions p
where lower(r.slug) = 'manager'
  and p.key in (
    'dashboard.view',
    'members.view', 'members.edit', 'members.approve', 'members.reject',
    'members.wallet', 'members.membership',
    'vehicles.view', 'vehicles.approve', 'vehicles.reject',
    'profile_changes.view', 'profile_changes.approve', 'profile_changes.reject',
    'requirements.view', 'exchanges.view',
    'fraud.view', 'fraud.manage',
    'cities.view', 'sliders.view', 'winners.view',
    'minimum_fares.view', 'fare_overrides.view', 'fare_overrides.manage',
    'priority.view', 'about.view', 'announcements.view',
    'birthday.view', 'lucky_draw.view', 'settings.view'
  )
on conflict do nothing;

-- Operator role
insert into public.admin_panel_role_permissions (role_id, permission_key)
select r.id, p.key
from public.admin_panel_roles r
cross join public.admin_panel_permissions p
where lower(r.slug) = 'operator'
  and p.key in (
    'dashboard.view',
    'members.view',
    'vehicles.view',
    'profile_changes.view',
    'requirements.view', 'exchanges.view',
    'fraud.view',
    'cities.view', 'sliders.view', 'winners.view',
    'minimum_fares.view', 'fare_overrides.view',
    'settings.view'
  )
on conflict do nothing;

-- Grants: service_role only (explicit)
grant select, insert, update, delete on public.admin_panel_users to service_role;
grant select, insert, update, delete on public.admin_panel_roles to service_role;
grant select, insert, update, delete on public.admin_panel_permissions to service_role;
grant select, insert, update, delete on public.admin_panel_role_permissions to service_role;
grant select, insert, update, delete on public.admin_panel_user_roles to service_role;
grant select, insert, update, delete on public.admin_panel_user_permissions to service_role;
grant select, insert on public.admin_panel_audit_logs to service_role;
-- Intentionally no UPDATE/DELETE grant on audit_logs for extra safety beyond RLS.
