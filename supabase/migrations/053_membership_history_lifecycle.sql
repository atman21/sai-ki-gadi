-- Membership audit ledger; never reconstruct unknown historic payments as verified payments.
create table if not exists public.membership_history (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.users(id) on delete cascade,
 membership_type text not null check (membership_type in ('gold','regular')),
 duration_days integer,
 starts_at timestamptz,
 expires_at timestamptz,
 amount numeric(12,2),
 payment_reference text,
 payment_status text not null default 'not_recorded' check (payment_status in ('not_recorded','paid','pending','refunded')),
 source text not null default 'admin' check (source in ('admin','legacy_snapshot','system')),
 status text not null default 'active' check (status in ('active','expired','cancelled')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists membership_history_user_date_idx on public.membership_history(user_id, created_at desc);
alter table public.membership_history enable row level security;
revoke all on public.membership_history from anon, authenticated;
grant select, insert, update on public.membership_history to service_role;

-- Create only a clearly marked snapshot; legacy history/payment cannot be recovered from users alone.
insert into public.membership_history(user_id, membership_type, duration_days, starts_at, expires_at, source, status)
select u.id, 'gold', u.membership_duration_days, u.membership_started_at, u.membership_expires_at,
       'legacy_snapshot', case when u.membership_expires_at > now() then 'active' else 'expired' end
from public.users u
where u.membership_type = 'gold' and u.membership_started_at is not null
and not exists (select 1 from public.membership_history h where h.user_id=u.id and h.source='legacy_snapshot');

-- Renewal and history writes must be a single transaction.
create or replace function public.admin_set_user_membership(
 p_user_id uuid, p_membership_type text, p_duration_days integer default null,
 p_amount numeric default null, p_payment_reference text default null,
 p_payment_status text default 'not_recorded'
) returns void language plpgsql security definer set search_path=public as $$
declare v_user public.users%rowtype; v_start timestamptz; v_end timestamptz;
begin
 if auth.role() <> 'service_role' then raise exception 'Not authorized'; end if;
 if p_membership_type not in ('gold','regular') then raise exception 'Invalid membership type'; end if;
 if p_payment_status not in ('paid','pending','not_recorded') then raise exception 'Invalid payment status'; end if;
 if p_amount is not null and p_amount < 0 then raise exception 'Invalid amount'; end if;
 select * into v_user from public.users where id=p_user_id for update;
 if not found then raise exception 'User not found'; end if;
 if p_membership_type = 'regular' then
   update public.membership_history set status='cancelled', updated_at=now() where user_id=p_user_id and status='active';
   update public.users set membership_type='regular',membership_started_at=null,membership_expires_at=null,membership_duration_days=null where id=p_user_id;
   insert into public.membership_history(user_id,membership_type,source,status,amount,payment_reference,payment_status)
   values(p_user_id,'regular','admin','active',p_amount,p_payment_reference,p_payment_status);
 else
   if p_duration_days is null or p_duration_days not between 1 and 3660 then raise exception 'Invalid membership duration'; end if;
   v_start := greatest(now(),coalesce(v_user.membership_expires_at,now()));
   v_end := v_start + make_interval(days=>p_duration_days);
   update public.membership_history set status='expired',updated_at=now() where user_id=p_user_id and status='active' and expires_at <= now();
   update public.users set membership_type='gold', membership_started_at=now(), membership_expires_at=v_end,
     membership_duration_days=p_duration_days where id=p_user_id;
   insert into public.membership_history(user_id,membership_type,duration_days,starts_at,expires_at,amount,payment_reference,payment_status,status)
   values(p_user_id,'gold',p_duration_days,v_start,v_end,p_amount,p_payment_reference,p_payment_status,'active');
 end if;
end; $$;
revoke all on function public.admin_set_user_membership(uuid,text,integer,numeric,text,text) from public,anon,authenticated;
grant execute on function public.admin_set_user_membership(uuid,text,integer,numeric,text,text) to service_role;

-- Idempotent expiry reconciliation. Run regularly from trusted server scheduler.
create or replace function public.admin_expire_memberships() returns integer
language plpgsql security definer set search_path=public as $$
declare v_count integer;
begin
 if auth.role() <> 'service_role' then raise exception 'Not authorized'; end if;
 update public.membership_history set status='expired',updated_at=now()
 where membership_type='gold' and status='active' and expires_at <= now();
 update public.users set membership_type='regular',membership_duration_days=null
 where membership_type='gold' and membership_expires_at is not null and membership_expires_at <= now();
 get diagnostics v_count=row_count;
 return v_count;
end; $$;
revoke all on function public.admin_expire_memberships() from public,anon,authenticated;
grant execute on function public.admin_expire_memberships() to service_role;
