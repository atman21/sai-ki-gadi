-- Verification queries after applying 065_admin_panel_rbac_and_audit.sql
-- Do NOT run against production without review.

-- 1) Tables exist
-- select table_name from information_schema.tables
-- where table_schema = 'public' and table_name like 'admin_panel_%'
-- order by 1;

-- 2) Permission catalog count (expect ~40+)
-- select count(*) from public.admin_panel_permissions;

-- 3) System roles
-- select slug, name, is_system from public.admin_panel_roles order by slug;

-- 4) Super Admin role has all permissions
-- select count(*) from public.admin_panel_role_permissions rp
-- join public.admin_panel_roles r on r.id = rp.role_id
-- where r.slug = 'super_admin';

-- 5) Attribution columns on users
-- select column_name from information_schema.columns
-- where table_schema = 'public' and table_name = 'users'
--   and column_name like 'verification_reviewed%';

-- 6) After first env Super Admin login, expect a row:
-- select id, username, is_super_admin, is_active, last_login_at
-- from public.admin_panel_users order by created_at;

-- 7) Recent audit events
-- select created_at, actor_username, action, description, success
-- from public.admin_panel_audit_logs
-- order by created_at desc limit 20;
