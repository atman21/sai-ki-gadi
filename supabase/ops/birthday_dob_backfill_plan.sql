-- T02 / T27 — Optional DOB reconciliation plan (MANUAL, non-destructive).
-- Authoritative field: public.users.birth_date
-- Legacy display field: public.users.date_of_birth (do not overwrite birth_date)
--
-- 1) Inspect conflicts / gaps (run first):
select
  count(*) filter (where birth_date is null and date_of_birth is not null) as legacy_only,
  count(*) filter (where birth_date is not null and date_of_birth is null) as authoritative_only,
  count(*) filter (
    where birth_date is not null
      and date_of_birth is not null
      and birth_date::text is distinct from left(date_of_birth::text, 10)
  ) as mismatched
from public.users;

-- 2) Preview rows that would be filled (no write):
-- select id, date_of_birth, birth_date
-- from public.users
-- where birth_date is null
--   and date_of_birth is not null
--   and date_of_birth::text ~ '^\d{4}-\d{2}-\d{2}'
-- limit 100;

-- 3) Safe fill only when birth_date is NULL (Staging first, after review):
-- update public.users
-- set birth_date = date_of_birth::date
-- where birth_date is null
--   and date_of_birth is not null
--   and date_of_birth::text ~ '^\d{4}-\d{2}-\d{2}';
--
-- Never run a destructive overwrite of non-null birth_date.
