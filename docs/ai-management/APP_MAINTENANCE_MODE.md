# SKG App-wide Maintenance Mode (with mobile whitelist)

**Status:** Implemented in Admin Web + Mobile App code · SQL **source only** (not applied) · **Not deployed**

Distinct from `skg_ai_settings.emergency_disabled` (AI Voice only).

## Authoritative verified phone

`public.users.phone` — E.164 `+91` + 10 digits after OTP (`verify-login-otp`).

## Schema (Mobile migration)

- `skg_app_maintenance_settings` (singleton id=1)
- `skg_app_maintenance_allowed_numbers` (private; service_role only)
- `skg_app_maintenance_owner_users` (trusted `users.id` bypass)
- RPC `get_skg_app_maintenance_status(p_locale)` → UI copy + `access_allowed` only
- Helpers: `skg_app_maintenance_is_active`, `skg_app_maintenance_user_may_bypass`, `skg_app_maintenance_blocks_writes`
- DML triggers on `requirements`, `exchange_listings`, `driver_listings`, `cab_avail` (when present)

## Remote control

After the first APK/AAB with this client ships, Admin can toggle maintenance / allowlist without a new store build. Mobile refreshes on launch, foreground, Retry, ~60s poll, and Realtime on settings (when subscribed).

## Date / time sync

- Admin `datetime-local` values are interpreted in the **Admin browser local TZ**, saved as **UTC ISO** into `timestamptz` (`start_at`, `end_at`, `expected_return_at`).
- RPC `get_skg_app_maintenance_status` returns those fields.
- Mobile normalizes timestamps (bare ISO → UTC) and displays start + completion in the **device local TZ**.
- Completion display / countdown uses `expected_return_at`, falling back to `end_at`.
- Countdown does **not** auto-disable maintenance; backend schedule/`enabled` flags remain authoritative.

## Staging apply order (manual)

1. Apply Mobile `20261126190000_skg_app_maintenance_mode.sql` on Staging (`mnbwcwaxfywwkaxiwndo`) only.
2. Apply Admin `20261126190000_skg_app_maintenance_admin_permissions.sql`.
3. Smoke-test Admin → App Management → Maintenance Mode.
4. Smoke-test Mobile with allowlisted vs non-allowlisted verified numbers.
5. Do **not** apply to Production without explicit approval.
