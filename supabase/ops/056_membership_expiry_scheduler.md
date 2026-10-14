# Membership automatic expiry — production setup (approval required)

**Do not enable in production without review.**  
**Do not apply SQL / deploy / schedule from this PR alone.**

## Problem

- Live data can retain `membership_type = 'gold'` after `membership_expires_at` has passed.
- RPC `public.admin_expire_memberships()` already exists (service_role only).
- It marks expired gold rows in `membership_history` as `expired` and sets matching users to `regular`.
- It **never** changes account ON/OFF (`users.status`) and **never** deletes payment/history rows.
- Live project does **not** have `pg_cron` installed, so `055_membership_expiry_cron.sql` cannot schedule jobs.

## Preferred design (this repo)

1. Deploy Edge Function `expire-memberships` (source: `supabase/functions/expire-memberships/`).
2. Schedule an external trusted caller to `POST` the function every 15 minutes with the service-role Bearer token.
3. Keep the Admin “Run expiry sweep now” button for manual reconciliation only.

### Edge Function

```bash
# AFTER approval
supabase functions deploy expire-memberships --project-ref <PROJECT_REF>
```

Invoke (manual test, after deploy):

```bash
curl -X POST "$SUPABASE_URL/functions/v1/expire-memberships" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Expected: `{ "ok": true, "expiredCount": <int> }`.

### Scheduler options when `pg_cron` is unavailable

#### A. Ubuntu host crontab (recommended for current nginx host)

On the same VPS that serves `saikigadi.babatravelsgujarat.com`, after secrets are stored outside the web root:

```cron
*/15 * * * * curl -fsS -X POST "$SUPABASE_URL/functions/v1/expire-memberships" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{}' >> /var/log/skg-expire-memberships.log 2>&1
```

#### B. Supabase Dashboard scheduled function (if enabled for the project)

Use Dashboard → Edge Functions → Schedules (or equivalent) to POST `expire-memberships` every 15 minutes. Only use if the project supports schedules **without** requiring `pg_cron`.

#### C. Revisit `pg_cron` later (optional)

If ops later enables `pg_cron` + `pg_net`, adapt the commented pattern in `055_membership_expiry_cron.sql` to HTTP-post the Edge Function (same as Birthday cron). Do not assume `pg_cron` is available today.

## Safety checklist before enabling

- [ ] Confirm RPC `admin_expire_memberships` exists and is granted only to `service_role`
- [ ] Confirm enum / check allows only `regular` | `gold` (no silver/platinum writes)
- [ ] Dry-run count of expired gold users (read-only):

```sql
select count(*) as expired_gold_still_typed_gold
from public.users
where membership_type = 'gold'
  and membership_expires_at is not null
  and membership_expires_at <= now();
```

- [ ] Deploy Edge Function
- [ ] One manual POST with service role
- [ ] Re-run count (should drop toward 0)
- [ ] Spot-check `users.status` unchanged for a known expired user
- [ ] Spot-check `membership_history` rows still present with `status='expired'`
- [ ] Enable scheduler (crontab / approved alternative)

## What this repo ships (code only)

| Artifact | Purpose |
|----------|---------|
| `supabase/functions/expire-memberships/` | Edge Function wrapper around `admin_expire_memberships` |
| `app/api/admin/memberships/expire` | Manual admin-panel sweep (session-gated) |
| `supabase/ops/055_membership_expiry_cron.sql` | Documented `pg_cron` stub — **not usable** until pg_cron exists |
| This file | Production enablement checklist |

## Membership enum note

Live `users.membership_type` supports only `regular` and `gold`. Admin change UI and RPCs already match that. Do not write silver/platinum.

## Out of scope for this PR / must not happen from CI

- Enabling crontab or Dashboard schedules
- Running the RPC against production
- Installing `pg_cron`
- Merging/deploying without review
