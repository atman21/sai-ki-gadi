-- Add permission: convert Regular membership → Gold.
-- Intentionally NOT assigned to any existing roles (including admin/manager).
-- Super Admin still has access via is_super_admin bypass / full permission set in app.

insert into public.admin_panel_permissions (key, module, description)
values (
  'members.convert_regular_to_gold',
  'members',
  'Allows an authorized user to convert a Regular Membership user into a Gold Membership user.'
)
on conflict (key) do update
set module = excluded.module,
    description = excluded.description;

-- Do not insert into admin_panel_role_permissions for existing roles.
-- Super Admins continue to receive all permissions via application-level Super Admin bypass.
