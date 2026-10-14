-- APPROVAL REQUIRED before applying in production.
-- Schedules periodic membership expiry via pg_cron (service role).
-- Account ON/OFF status is never modified by admin_expire_memberships().
--
-- Replace PROJECT_REF and SERVICE_ROLE_KEY placeholders before running.

-- select cron.schedule(
--   'skg-admin-expire-memberships',
--   '*/15 * * * *',
--   $$
--   select public.admin_expire_memberships();
--   $$
-- );

-- Verify:
-- select * from cron.job where jobname = 'skg-admin-expire-memberships';
