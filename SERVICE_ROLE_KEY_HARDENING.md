# Service-role key hardening

Status: code only. No VPS change, no key rotation, no production SQL, and no merge.

This branch is separate from mobile PR #29 (`security/fraud-reports-rls-s0-1`), mobile PR #30 (`security/s0-2-privileged-rpc-grants`), admin PR #16, and admin PR #17.

Admin code is on `security/service-role-key-hardening` from `origin/main` in `sai-ki-gadi`. The mobile client boundary and Edge Function change are on the same branch name in `sai-ki-gadi-app`, starting at S0-2 tip `94f1208`. Do not merge those branches into PR #29 or PR #30.

## What the code does today

- The mobile app reads `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` only. Client directories do not reference a service-role key.
- Edge Functions read `SUPABASE_SERVICE_ROLE_KEY` from the function environment. `send-fcm-all` and `process-notification-outbox` no longer substitute that key when `SUPABASE_ANON_KEY` is missing.
- Admin used to read `process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY` by its static name. Next.js inlines static `NEXT_PUBLIC_` reads into build output. A scan of 38 current client build files did not find the key, so the browser chunks in that scan do not contain it. The static read is removed. Admin now refuses to start while a service-role value is still present under the public-prefixed name.
- Admin no longer falls back to a built-in password, to `ADMIN_PASSWORD` as the session secret, or to a built-in session secret. Database admin accounts still sign in. Env-password bootstrap runs only when `ADMIN_PASSWORD` is set to a non-default value. Every session requires `ADMIN_SESSION_SECRET`.

`ADMIN_PASSWORD` and `ADMIN_SESSION_SECRET` on the live VPS are still unverified. Do not deploy this Admin build until those values are confirmed.

## Live process to reconfirm first

Known previous hosting, not proof of the process that is live today:

- Hostinger VPS `atman-vps`
- Nginx site `saikigadi.babatravelsgujarat.com` forwarding to `127.0.0.1:3000`
- PM2 process `sai-ki-gadi` under `atman_user`
- Path `/var/www/apps/sai-ki-gadi`
- Separate tree `/var/www/apps/sai-ki-gadi-v2` on port `3001`. Leave it alone unless it is the live upstream.

Record the live PM2 name, cwd, release commit, and env **names** only. Do not print values.

## Dependencies

Server-only, required before the new Admin process stays up:

- `SUPABASE_SERVICE_ROLE_KEY` — the secret key, not the anon key
- `ADMIN_PASSWORD` — required only for the env bootstrap account; must not be the old code default
- `ADMIN_SESSION_SECRET` — at least 32 characters and different from `ADMIN_PASSWORD`. Changing it signs everyone out.

Must remain public:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Must be absent from the VPS env, PM2 dump, ecosystem file, and shell profile:

- `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY`

Edge Functions already receive `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` from Supabase. Do not copy the service-role key into Expo public env or into the mobile repo.

S0-1 fraud-report compatibility and the S0-2 grant migration stay on their own branches. Do not deploy them in this change.

## Order

Do this only after an explicit owner approval. Do not rotate the key before the public name is gone.

1. Reconfirm the live Nginx upstream and PM2 process. Save the current release commit and a private env backup outside the web root and outside git.
2. Confirm `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_PASSWORD`, and `ADMIN_SESSION_SECRET` are set, and that the password and session secret are not the old code defaults. If the session secret is missing, generate a new one of at least 32 characters and store it only in the server env. Existing admin cookies will stop validating.
3. Remove `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY` from the live env and from any PM2 ecosystem file. Restart the **current** Admin release. Confirm login and one privileged Admin action still work. The old build does not need the public name.
4. Deploy this Admin branch. If the public name is still set, the process exits on startup. Rollback is the previous release commit with the cleaned env.
5. Rebuild and search `.next/static` for `service_role`. A match means stop. Do not print the matching line if it contains key material.
6. Rotate the service-role key only after steps 3–5 pass. Update server-side consumers in the same window: VPS `SUPABASE_SERVICE_ROLE_KEY`, Supabase Edge Function secrets, and any cron that sends that key as a bearer. Do not put the new key in `NEXT_PUBLIC_` or `EXPO_PUBLIC_`.
7. If the Supabase dashboard can roll only the service-role key, do that. If the only control rotates the JWT secret, stop. That also changes the anon key and breaks installed mobile apps until a new build ships. That rotation needs a separate owner approval.
8. Restart PM2 and reload the Edge Functions. Smoke-test Admin login, one privileged Admin API, and one member anon read. Do not change production bookings.
9. Disable the old service-role key only after the new key works.

## Rollback

- Admin will not boot: start the previous release. Keep the public-prefixed service-role name unset.
- New key applied and Admin fails: put the previous key back into server-only `SUPABASE_SERVICE_ROLE_KEY` and restart. Do not restore the public-prefixed name.
- JWT secret already rotated: recovery is the previous JWT secret or a mobile build with the new anon key. Do not start that rotation here.
- An Edge Function fails because `SUPABASE_ANON_KEY` is missing: set the anon key in the function secrets. Do not point the user-auth client at the service-role key.

## Remaining risk

The service-role key has lived in a public-prefixed variable on the server. Current client chunks did not contain it, but the value must still be treated as exposed. Rotation is the remaining control, and it is not done in this change. `send-push` still uses the service-role key inside the function and does not check the caller in its own code. Leave that for a separate review so notification delivery is not changed here.
