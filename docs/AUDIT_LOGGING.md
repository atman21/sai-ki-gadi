# Admin Audit Logging

Single system of record: `public.admin_panel_audit_logs` via `writeAdminAuditLog()` in `lib/admin-audit.ts`.

## Deploy

1. Apply migration (additive, safe for existing rows):

```bash
# Via your usual Supabase migration flow, e.g.:
supabase db push
# or run supabase/migrations/066_admin_audit_logs_enrichment.sql in the SQL editor
```

2. Redeploy / restart the Next.js admin app.

3. Confirm Super Admin / Admin roles have:
   - `audit_logs.view`
   - `audit_logs.view_details`
   - `audit_logs.export`

Migration 066 seeds these onto `super_admin` and `admin` system roles.

## Verify

```bash
npm run test:admin-audit
npm run build
```

## Notes

- Audit rows are append-only for the app (service role SELECT+INSERT only).
- Actor identity is always taken from the server session — never from request body.
- Secrets (passwords, tokens, OTPs, service-role keys) are redacted before insert.
- Notification test actions log *send requested* / provider status, not “delivered”.
- Until migration 066 is applied, writes fall back to the legacy column set automatically.
