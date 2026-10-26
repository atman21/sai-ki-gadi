-- Strict Gold membership rule:
-- Active Gold (membership_expires_at > now()) cannot be downgraded to Regular
-- by admin_set_user_membership, direct UPDATEs, or any other path.
-- Downgrade to Regular is allowed only when membership_expires_at <= now()
-- (automatic expiry via admin_expire_memberships, or cleanup of already-expired rows).
-- Gold with missing/invalid expiry is never blindly downgraded.
--
-- Timezone: membership_expires_at is timestamptz; comparisons use PostgreSQL now()
-- (UTC wall-clock). No client/local timezone conversion.

begin;

-- ---------------------------------------------------------------------------
-- 1) admin_set_user_membership — block premature Regular assignment
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_user_membership(
  p_user_id uuid,
  p_membership_type text,
  p_duration_days integer default null,
  p_amount numeric default null,
  p_payment_reference text default null,
  p_payment_status text default 'not_recorded'
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.users%rowtype;
  v_start timestamptz;
  v_end timestamptz;
  v_type text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Not authorized';
  end if;

  if p_membership_type not in ('gold', 'regular') then
    raise exception 'Invalid membership type';
  end if;
  if p_payment_status not in ('paid', 'pending', 'not_recorded') then
    raise exception 'Invalid payment status';
  end if;
  if p_amount is not null and p_amount < 0 then
    raise exception 'Invalid amount';
  end if;

  select * into v_user from public.users where id = p_user_id for update;
  if not found then
    raise exception 'User not found';
  end if;

  v_type := lower(trim(coalesce(v_user.membership_type::text, '')));

  if p_membership_type = 'regular' then
    -- Strict rule: never manually downgrade unexpired (or expiry-less) Gold.
    if v_type = 'gold' then
      if v_user.membership_expires_at is null then
        raise exception
          'Cannot downgrade Gold membership with missing expiry timestamp. Fix expiry data or wait for automatic expiry reconciliation after expiry is set.';
      end if;
      if v_user.membership_expires_at > now() then
        raise exception
          'Cannot downgrade active Gold membership before expiry (%). Gold reverts to Regular only after expiry via admin_expire_memberships.',
          v_user.membership_expires_at;
      end if;
      -- Expired Gold: allow cleanup to Regular (same outcome as expiry job).
    end if;

    update public.membership_history
    set status = 'cancelled', updated_at = now()
    where user_id = p_user_id and status = 'active';

    update public.users
    set membership_type = 'regular',
        membership_started_at = null,
        membership_expires_at = null,
        membership_duration_days = null
    where id = p_user_id;

    insert into public.membership_history (
      user_id, membership_type, source, status,
      amount, payment_reference, payment_status
    )
    values (
      p_user_id, 'regular', 'admin', 'active',
      p_amount, p_payment_reference, p_payment_status
    );
  else
    -- Gold convert / renew (unchanged stacking behaviour).
    if p_duration_days is null or p_duration_days not between 1 and 3660 then
      raise exception 'Invalid membership duration';
    end if;

    v_start := greatest(now(), coalesce(v_user.membership_expires_at, now()));
    v_end := v_start + make_interval(days => p_duration_days);

    update public.membership_history
    set status = 'expired', updated_at = now()
    where user_id = p_user_id
      and status = 'active'
      and expires_at <= now();

    update public.users
    set membership_type = 'gold',
        membership_started_at = now(),
        membership_expires_at = v_end,
        membership_duration_days = p_duration_days
    where id = p_user_id;

    insert into public.membership_history (
      user_id, membership_type, duration_days, starts_at, expires_at,
      amount, payment_reference, payment_status, status
    )
    values (
      p_user_id, 'gold', p_duration_days, v_start, v_end,
      p_amount, p_payment_reference, p_payment_status, 'active'
    );
  end if;
end;
$$;

revoke all on function public.admin_set_user_membership(uuid, text, integer, numeric, text, text)
  from public, anon, authenticated;
grant execute on function public.admin_set_user_membership(uuid, text, integer, numeric, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 2) BEFORE UPDATE trigger — block any premature Gold → Regular write
--    (covers direct service_role UPDATEs that bypass the RPC).
-- ---------------------------------------------------------------------------
create or replace function public.users_prevent_premature_gold_downgrade()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old text;
  v_new text;
begin
  v_old := lower(trim(coalesce(old.membership_type::text, '')));
  v_new := lower(trim(coalesce(new.membership_type::text, '')));

  if v_old = 'gold' and v_new = 'regular' then
    if old.membership_expires_at is null then
      raise exception
        'Cannot downgrade Gold membership with missing expiry timestamp';
    end if;
    if old.membership_expires_at > now() then
      raise exception
        'Cannot downgrade active Gold membership before expiry (%)',
        old.membership_expires_at;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists users_prevent_premature_gold_downgrade_trg on public.users;

create trigger users_prevent_premature_gold_downgrade_trg
  before update of membership_type on public.users
  for each row
  execute procedure public.users_prevent_premature_gold_downgrade();

comment on function public.users_prevent_premature_gold_downgrade() is
  'Blocks Gold→Regular updates while membership_expires_at is null or still in the future. Expired Gold may become Regular.';

-- ---------------------------------------------------------------------------
-- 3) admin_expire_memberships — idempotent; only rows past expiry;
--    align Regular fields with admin_set path; never touch missing expiry.
-- ---------------------------------------------------------------------------
create or replace function public.admin_expire_memberships()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Not authorized';
  end if;

  -- Mark expired Gold history rows (idempotent for already-expired).
  update public.membership_history
  set status = 'expired', updated_at = now()
  where membership_type = 'gold'
    and status = 'active'
    and expires_at is not null
    and expires_at <= now();

  -- Revert users whose Gold validity has passed. Skip missing expiry.
  -- Clear plan fields so the row matches a Regular member.
  update public.users
  set membership_type = 'regular',
      membership_started_at = null,
      membership_expires_at = null,
      membership_duration_days = null
  where lower(trim(coalesce(membership_type::text, ''))) = 'gold'
    and membership_expires_at is not null
    and membership_expires_at <= now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.admin_expire_memberships() from public, anon, authenticated;
grant execute on function public.admin_expire_memberships() to service_role;

comment on function public.admin_expire_memberships() is
  'Idempotent Gold expiry: sets expired Gold users to Regular using DB now(). Skips Gold rows with null membership_expires_at. Does not change users.status.';

commit;
