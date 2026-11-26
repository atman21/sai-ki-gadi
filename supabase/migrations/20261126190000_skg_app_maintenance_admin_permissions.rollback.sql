-- Rollback Admin permission seed for app maintenance (SOURCE ONLY).

begin;

delete from public.admin_panel_role_permissions
where permission_key in ('app.view', 'app.manage');

delete from public.admin_panel_permissions
where key in ('app.view', 'app.manage');

commit;
