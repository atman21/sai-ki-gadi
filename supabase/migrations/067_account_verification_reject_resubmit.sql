-- Account document verification: rejected → resubmit → pending for Admin Panel.
-- One verification record per user (users.verification_status + user_identity_documents).
-- Clients cannot self-approve; resubmit to pending is allowed only from rejected.

begin;

-- ---------------------------------------------------------------------------
-- Columns on public.users
-- ---------------------------------------------------------------------------

alter table public.users
  add column if not exists verification_status text;

alter table public.users
  add column if not exists verification_rejection_reason text;

alter table public.users
  add column if not exists verification_submitted_at timestamptz;

-- Backfill legacy rows before tightening constraints.
update public.users
set verification_status = case
  when verified is true then 'approved'
  else coalesce(nullif(trim(verification_status), ''), 'pending')
end
where verification_status is null
   or trim(verification_status) = ''
   or verification_status not in ('pending', 'approved', 'rejected');

alter table public.users
  alter column verification_status set default 'pending';

alter table public.users
  alter column verification_status set not null;

do $$
begin
  alter table public.users
    add constraint users_verification_status_chk
    check (verification_status in ('pending', 'approved', 'rejected'));
exception
  when duplicate_object then null;
end $$;

create index if not exists users_verification_status_idx
  on public.users (verification_status);

create index if not exists users_verification_submitted_at_idx
  on public.users (verification_submitted_at desc nulls last);

comment on column public.users.verification_status is
  'Account document verification queue: pending | approved | rejected.';
comment on column public.users.verification_rejection_reason is
  'Last admin rejection reason shown to the user while status is rejected.';
comment on column public.users.verification_submitted_at is
  'Last time identity documents were submitted or resubmitted for review.';

-- ---------------------------------------------------------------------------
-- Client cannot self-approve; may only move rejected → pending (resubmit).
-- ---------------------------------------------------------------------------

create or replace function public.users_enforce_membership_verified()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.membership_type := 'user'::public.user_membership;
      new.verified := false;
      new.verification_status := 'pending';
      new.verification_rejection_reason := null;
      new.verification_reviewed_by := null;
      new.verification_reviewed_at := null;
      new.verification_reviewed_by_admin_id := null;
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if auth.uid() is not null
       and new.auth_user_id = auth.uid()
    then
      -- Never allow self-promotion of membership / verified flag.
      new.membership_type := old.membership_type;
      new.verified := old.verified;

      -- Lock admin review attribution fields.
      new.verification_reviewed_by := old.verification_reviewed_by;
      new.verification_reviewed_at := old.verification_reviewed_at;
      new.verification_reviewed_by_admin_id := old.verification_reviewed_by_admin_id;

      -- Status transitions from the authenticated user:
      --   rejected → pending  (document resubmit)
      --   pending  → pending  (idempotent)
      -- Never allow setting approved / rejected from the client.
      if new.verification_status is distinct from old.verification_status then
        if old.verification_status = 'rejected'
           and new.verification_status = 'pending' then
          -- Resubmit: clear live rejection reason; keep admin attribution until next review.
          new.verification_rejection_reason := null;
          if new.verification_submitted_at is null then
            new.verification_submitted_at := timezone('utc', now());
          end if;
        else
          new.verification_status := old.verification_status;
          new.verification_rejection_reason := old.verification_rejection_reason;
          new.verification_submitted_at := old.verification_submitted_at;
        end if;
      end if;
    end if;
    return new;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- After identity docs are fully uploaded, mark the user pending for admin review.
-- ---------------------------------------------------------------------------

create or replace function public.identity_documents_queue_verification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_has_all boolean;
begin
  v_has_all :=
    nullif(trim(coalesce(new.driving_license_front_path, '')), '') is not null
    and nullif(trim(coalesce(new.driving_license_back_path, '')), '') is not null
    and nullif(trim(coalesce(new.aadhaar_front_path, '')), '') is not null
    and nullif(trim(coalesce(new.aadhaar_back_path, '')), '') is not null;

  if not v_has_all then
    return new;
  end if;

  update public.users u
  set
    verification_status = 'pending',
    verification_submitted_at = timezone('utc', now()),
    verification_rejection_reason = case
      when u.verification_status = 'rejected' then null
      else u.verification_rejection_reason
    end,
    verified = false,
    updated_at = timezone('utc', now())
  where u.id = new.user_id
    and u.verified is not true
    and coalesce(u.verification_status, 'pending') in ('pending', 'rejected');

  return new;
end;
$$;

drop trigger if exists identity_documents_queue_verification_trg
  on public.user_identity_documents;
create trigger identity_documents_queue_verification_trg
after insert or update of
  driving_license_front_path,
  driving_license_back_path,
  aadhaar_front_path,
  aadhaar_back_path
on public.user_identity_documents
for each row
execute procedure public.identity_documents_queue_verification();

commit;
