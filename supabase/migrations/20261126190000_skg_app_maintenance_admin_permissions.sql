-- Admin RBAC seed for App Maintenance Mode (SOURCE ONLY).
-- Additive / idempotent. Table DDL lives in Mobile migration
-- 20261126190000_skg_app_maintenance_mode.sql (shared Staging DB).
--
-- Do NOT apply to Production without approval.

insert into public.admin_panel_permissions (key, module, description) values
  ('app.view', 'app', 'View app maintenance status and allowlist'),
  ('app.manage', 'app', 'Toggle maintenance and manage allowlist / owners')
on conflict (key) do update
set module = excluded.module,
    description = excluded.description;

insert into public.admin_panel_role_permissions (role_id, permission_key)
select r.id, p.key
from public.admin_panel_roles r
cross join (
  values
    ('app.view'),
    ('app.manage')
) as p(key)
where lower(r.slug) in ('super_admin', 'admin')
on conflict do nothing;

insert into public.admin_panel_role_permissions (role_id, permission_key)
select r.id, p.key
from public.admin_panel_roles r
cross join (
  values
    ('app.view')
) as p(key)
where lower(r.slug) in ('manager', 'operator')
on conflict do nothing;
