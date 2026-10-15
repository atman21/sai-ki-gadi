-- READ-ONLY verification for Admin trip statistics.
-- Do not run mutations. Safe to execute in SQL editor after approval for inspection.

-- 1) Single (requirements) assigned TO user
select
  assigned_to_user_id as user_id,
  count(*)::int as trips_assigned_to_single
from public.requirements
where booked is true
  and assigned_to_user_id is not null
group by assigned_to_user_id
order by trips_assigned_to_single desc
limit 50;

-- 2) Exchange assigned TO user
select
  exchanged_to_user_id as user_id,
  count(*)::int as trips_assigned_to_exchange
from public.exchange_listings
where booked is true
  and exchanged_to_user_id is not null
group by exchanged_to_user_id
order by trips_assigned_to_exchange desc
limit 50;

-- 3) Combined assigned-TO totals (matches Admin dashboard aggregation)
with single as (
  select assigned_to_user_id as user_id, count(*)::int as c
  from public.requirements
  where booked is true and assigned_to_user_id is not null
  group by 1
),
exchange as (
  select exchanged_to_user_id as user_id, count(*)::int as c
  from public.exchange_listings
  where booked is true and exchanged_to_user_id is not null
  group by 1
)
select
  coalesce(s.user_id, e.user_id) as user_id,
  coalesce(s.c, 0) as single_count,
  coalesce(e.c, 0) as exchange_count,
  coalesce(s.c, 0) + coalesce(e.c, 0) as trips_assigned_to
from single s
full outer join exchange e on e.user_id = s.user_id
order by trips_assigned_to desc
limit 50;

-- 4) Pagination boundary sanity: page size 1000 must not drop trailing rows
-- Compare exact totals vs paged sums when validating Admin loaders.
select
  (select count(*) from public.requirements where booked is true and assigned_to_user_id is not null) as requirements_assigned_rows,
  (select count(*) from public.exchange_listings where booked is true and exchanged_to_user_id is not null) as exchange_assigned_rows;

-- 5) Spot-check one user (replace :user_id)
-- select count(*) from public.requirements
-- where booked is true and assigned_to_user_id = :user_id;
-- select count(*) from public.exchange_listings
-- where booked is true and exchanged_to_user_id = :user_id;
