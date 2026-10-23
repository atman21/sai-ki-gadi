-- Enrich admin_panel_audit_logs for searchable investigation fields.
-- Backward-compatible: additive columns only; existing rows remain valid.

alter table public.admin_panel_audit_logs
  add column if not exists outcome text;

alter table public.admin_panel_audit_logs
  add column if not exists reason text;

alter table public.admin_panel_audit_logs
  add column if not exists entity_label text;

alter table public.admin_panel_audit_logs
  add column if not exists actor_role text;

alter table public.admin_panel_audit_logs
  add column if not exists related_user_id text;

alter table public.admin_panel_audit_logs
  add column if not exists http_method text;

alter table public.admin_panel_audit_logs
  add column if not exists route_name text;

-- Backfill outcome from legacy success flag where missing.
update public.admin_panel_audit_logs
set outcome = case when success then 'success' else 'failure' end
where outcome is null;

alter table public.admin_panel_audit_logs
  alter column outcome set default 'success';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'admin_panel_audit_logs_outcome_check'
  ) then
    alter table public.admin_panel_audit_logs
      add constraint admin_panel_audit_logs_outcome_check
      check (outcome in ('success', 'failure', 'partial', 'pending', 'rejected'));
  end if;
end $$;

create index if not exists admin_panel_audit_logs_outcome_idx
  on public.admin_panel_audit_logs (outcome, created_at desc);

create index if not exists admin_panel_audit_logs_related_user_idx
  on public.admin_panel_audit_logs (related_user_id, created_at desc)
  where related_user_id is not null;

create index if not exists admin_panel_audit_logs_request_idx
  on public.admin_panel_audit_logs (request_id)
  where request_id is not null;

create index if not exists admin_panel_audit_logs_success_created_idx
  on public.admin_panel_audit_logs (success, created_at desc);

-- Fine-grained audit permissions (idempotent seed).
insert into public.admin_panel_permissions (key, module, description) values
  ('audit_logs.view_details', 'audit', 'View expanded audit event details and field diffs'),
  ('audit_logs.export', 'audit', 'Export filtered audit logs')
on conflict (key) do update
set module = excluded.module,
    description = excluded.description;

-- Grant new audit permissions to Super Admin + Admin system roles.
insert into public.admin_panel_role_permissions (role_id, permission_key)
select r.id, p.key
from public.admin_panel_roles r
cross join (values
  ('audit_logs.view_details'),
  ('audit_logs.export')
) as p(key)
where r.slug in ('super_admin', 'admin')
on conflict do nothing;

comment on column public.admin_panel_audit_logs.outcome is
  'Normalized result: success | failure | partial | pending | rejected';
comment on column public.admin_panel_audit_logs.reason is
  'Optional administrative reason or note provided with the action';
comment on column public.admin_panel_audit_logs.entity_label is
  'Human-readable snapshot label for the affected entity';
comment on column public.admin_panel_audit_logs.actor_role is
  'Snapshot role context (super_admin, admin, system, env_bootstrap)';
comment on column public.admin_panel_audit_logs.related_user_id is
  'Related customer/driver user id when the primary resource is not the user';
