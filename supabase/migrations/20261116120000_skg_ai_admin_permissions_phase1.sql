-- Phase 1 — SKG AI Management Console RBAC seed (Admin Web)
-- ---------------------------------------------------------------------------
-- Additive / idempotent. Does NOT create FAQ/AI runtime tables (those remain
-- owned by Mobile T29 migration 20261110210000_skg_ai_help_center.sql).
--
-- SAFETY:
--   - Do NOT apply from this session without explicit Staging approval.
--   - Do NOT run against Live Production.
--   - Does not grant help_ai.manage to manager/operator (view-only for those).
--   - Role matrix mirrors Mobile T29 seed (super_admin/admin/manager/operator).
--   - Super Admin actors also receive all keys via is_super_admin bypass in app.
--
-- Required audit action names (for later Admin APIs; not written here):
--   help.faq.create | help.faq.update | help.faq.publish | help.faq.unpublish
--   help_ai.settings.update | help_ai.emergency_disable | help_ai.emergency_enable
--   help_ai.voice_connectivity.verify

insert into public.admin_panel_permissions (key, module, description) values
  ('help.view', 'help', 'View Help Center FAQ content'),
  ('help.manage', 'help', 'Create/edit/publish Help Center FAQs'),
  ('help_ai.view', 'help_ai', 'View AI Help settings and usage analytics'),
  ('help_ai.manage', 'help_ai', 'Update AI settings and emergency disable')
on conflict (key) do update
set module = excluded.module,
    description = excluded.description;

-- super_admin + admin: full Help + AI management
insert into public.admin_panel_role_permissions (role_id, permission_key)
select r.id, p.key
from public.admin_panel_roles r
cross join (
  values
    ('help.view'),
    ('help.manage'),
    ('help_ai.view'),
    ('help_ai.manage')
) as p(key)
where lower(r.slug) in ('super_admin', 'admin')
on conflict do nothing;

-- manager: FAQ manage + AI view (no help_ai.manage)
insert into public.admin_panel_role_permissions (role_id, permission_key)
select r.id, p.key
from public.admin_panel_roles r
cross join (
  values
    ('help.view'),
    ('help.manage'),
    ('help_ai.view')
) as p(key)
where lower(r.slug) = 'manager'
on conflict do nothing;

-- operator: view-only
insert into public.admin_panel_role_permissions (role_id, permission_key)
select r.id, p.key
from public.admin_panel_roles r
cross join (
  values
    ('help.view'),
    ('help_ai.view')
) as p(key)
where lower(r.slug) = 'operator'
on conflict do nothing;
