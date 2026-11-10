# SKG Admin Web — Client Task T02 Birthday Automation Audit

**Audit date:** 2026-11-10  
**Scope:** Admin Web repository only — `/var/www/html/merigaadiwebsite`  
**Mode:** Strict READ-ONLY  
**Mobile App:** Not audited in this session (backend/Mobile dependencies identified only)  
**Limits:** `gh` CLI unavailable; staging/production runtime, Edge deploy, and cron enablement **NOT VERIFIED**; no Live DB access

---

## 1. Executive verdict

### Final status (Admin contribution to T02): **PARTIALLY COMPLETE**

Admin Web has substantial birthday **operations tooling** merged into `origin/main` (DOB edit UI, notification settings, status/test APIs, Edge Function source, migration/cron SQL, in-app announcement birthday flags). That is **not** the full Client T02 acceptance package.

| Layer | Verdict |
|-------|---------|
| Admin DOB edit → `users.birth_date` | Implemented (main) |
| Duplicate `date_of_birth` display | Still present (inconsistent UX; not used by automation) |
| Birthday notification Admin config | Implemented (main) |
| RBAC `birthday.*` / `members.edit` for DOB | Hardened on A21 branch; **weaker on `origin/main`** |
| Collective “all names in one push” | **Not implemented** (EF sends one blast **per** birthday person) |
| Common once/day birthday popup product | Only generic announcement `is_birthday_template` flags — not proven as T02 common popup |
| Personal popup every app open | Mobile concern — **out of Admin scope**; Admin docs say popup “unchanged” |
| Cron + Edge deployed & working | Source present; **runtime NOT VERIFIED** |

**Do not claim birthday automation works** solely because Admin can edit DOB.

---

## 2. Repositories, branches, commits

| Ref | SHA / tip | Birthday-relevant? | Pushed? | In `origin/main`? |
|-----|-----------|--------------------|---------|-------------------|
| Current HEAD | `fix/dashboard-performance-rbac-a21-20261102` @ `1b0c9a4` | Yes — A13 RBAC on birthday/DOB routes | Yes (`origin/fix/dashboard-performance-rbac-a21-20261102`) | **No** (7 commits ahead of main) |
| `origin/main` | `a88a6b3` | Birthday feature commits present | Yes | — |
| `origin/feature/admin-birthday-dob-edit-20261009` | `89d3204` | DOB picker | Yes | **Yes** (ancestor of main via PR #3) |
| Key feature commits | `3bfcd5b` scheduled birthday notifs; `9c738dd` complete birthday impl; `1f8d2b7` secure birthday date API; `89d3204` editable DOB picker; `d3257d7` Merge PR #3 | Yes | Yes | **Yes** |
| A13 RBAC commit | `36aaa40` harden A13 | Birthday API permission gates | Yes (on A21 remote) | **No** |

**PR evidence (from merge commits; `gh` unavailable):**
- PR **#3** `feature/admin-birthday-dob-edit-20261009` → merged to main (`d3257d7`)
- Later birthday notification work landed via admin-panel merges (e.g. `#11` / related commits on main)

---

## 3. Authoritative DOB source

### Automation / write path uses **`users.birth_date` only**

| Consumer | Column |
|----------|--------|
| RPC `list_users_with_birthday_on` | `u.birth_date` (`supabase/migrations/051_birthday_notifications.sql:88–90`) |
| Admin PUT `/api/admin/users/[id]/birth-date` | Updates `birth_date` only |
| Birthday tab filters / Add|Edit DOB modal | Reads/writes `birth_date` |
| Edge Function birthday lookup | Via `list_users_with_birthday_on` → `birth_date` |

### Second field **`users.date_of_birth`**

| Surface | Behavior |
|---------|----------|
| Users table columns + Excel export | Displays **both** “Date of Birth” (`date_of_birth`) and “Birth Date” (`birth_date`) — `dashboard-tabs.tsx` ~2408–2409, 3608–3763 |
| Member profile sections | Shows both labels — `admin-user-profile-sections.tsx:398–403` |
| Admin write APIs | **No** Admin update of `date_of_birth` found |
| Birthday automation | **Does not** read `date_of_birth` |

**Conclusion:** Operationally there is **one authoritative automation source (`birth_date`)**, but Admin UI still presents **two inconsistent DOB fields**. If signup/profile ever populates only `date_of_birth`, birthday automation will miss that member. This is a **data-integrity risk** aligned with client T27.

---

## 4. Audit checklist (Admin areas 1–14)

### 1) Admin Member DOB fields

| Item | Status | Evidence |
|------|--------|----------|
| `birth_date` loaded for dashboard users | **Implemented** | `app/dashboard/page.tsx:263,322` |
| `date_of_birth` also loaded | **Implemented (duplicate)** | `page.tsx:263,323` |
| Profile detail shows both | **Implemented (duplicate)** | `components/admin-user-profile-sections.tsx:398–403` |
| Birthday tab uses `birth_date` | **Implemented** | `dashboard-tabs.tsx` birthday filter ~1515; table ~4368 |

**Missing:** Single-field UX; sync/migration strategy if `date_of_birth` differs.

### 2) Add Member and Edit Member forms

| Item | Status | Evidence |
|------|--------|----------|
| Admin “create new member” form with DOB | **Not found** | No Admin insert-user flow setting DOB; members originate from mobile signup / pending verification |
| Edit DOB from Birthday tab | **Implemented** | Modal Add/Edit DOB → PUT birth-date API (`dashboard-tabs.tsx` ~4192–4201, 4393–4395) |
| Edit `date_of_birth` | **Not implemented** | Display-only |

**Remaining:** If product requires Admin Add Member with DOB, that form does not exist. DOB edit exists on Birthday tab only (not a full member edit form for both columns).

### 3) DOB validation and date format

| Item | Status | Evidence |
|------|--------|----------|
| Format `YYYY-MM-DD` | **Implemented** | `birth-date/route.ts` `validDate` regex `^\d{4}-\d{2}-\d{2}$` |
| Calendar validity + not future + year ≥ 1900 | **Implemented** | Same file L6–12 |
| HTML `type="date"` min/max | **Implemented** | `dashboard-tabs.tsx` DOB modal input |
| UUID validation on user id | **HEAD (A21):** `isAdminUuid`; **main:** weaker regex | HEAD `birth-date/route.ts:23`; main uses older UUID regex |

### 4) Duplicate DOB fields

| Item | Status |
|------|--------|
| Dual columns in Users UI/export | **Confirmed defect** (vs T27 / clean T02 ops) |
| Dual labels on profile | **Confirmed** |
| Birthday automation ignores `date_of_birth` | **Confirmed** |

### 5) Member profile/detail screens

| Item | Status | Evidence |
|------|--------|----------|
| Profile extensions show Birth Date + Date of Birth | **Yes** | `admin-user-profile-sections.tsx` |
| Profile change reviews label `birth_date` | **Yes** | `profile-changes/[id]/page.tsx:58` |
| Deep link from Birthday tab to user | **Yes** | `/dashboard/users/${id}?tab=birthday-date` (~4349) |

### 6) Birthday-related Admin pages and controls

| Control | Status | Location |
|---------|--------|----------|
| Birthday tab | **Implemented** | `dashboard-tabs.tsx` tab key `birthday-date` |
| Search/filter/sort/paginate birthday users | **Implemented** | ~1489–1594, 4207–4437 |
| Birthday Notifications card (enable, time, status, save, test) | **Implemented** | ~4034–4162 |
| Docs inventory | **Present** | `BIRTHDAY_NOTIFICATION_IMPLEMENTATION.md` |

SSR tab visibility gated by `birthday.view` on A21 HEAD (`page.tsx:422`, settings load gated ~518).

### 7) Admin RBAC and permissions

| Permission | Catalog | Used on HEAD (A21) | On `origin/main` |
|------------|---------|-------------------|------------------|
| `birthday.view` | `lib/admin-permissions.ts:44` | Settings GET, status, tab SSR | APIs use **`requireAdminApi()` only** (session gate) |
| `birthday.manage` | `:45` | Settings PUT, test send | Same — session only |
| `members.edit` | — | DOB PUT | DOB PUT uses **`requireAdminApi()`** |

**Related A13:** RBAC hardening for these routes is on branch tip `36aaa40`…`1b0c9a4`, **pushed**, **not merged** to Admin main.

**Tests (static, this audit):**
- `npm run test:admin-rbac-a13` → **OK** (HEAD)
- `npm run test:admin-rbac-a13-hardening` → **OK** (includes birth-date UUID)
- `npm run test:admin-dashboard-a21` → **OK** (includes `birthday.view`)
- HTTP 401/403 matrix / staging session → **NOT executed**

### 8) Birthday notification configuration

| Setting | Status | Evidence |
|---------|--------|----------|
| Table `birthday_notification_settings` | Schema in repo | `051_birthday_notifications.sql` |
| Admin GET/PUT settings | Implemented | `app/api/admin/birthday-notification-settings/route.ts` |
| `enabled` + `send_time` HH:MM | Implemented | UI + `normalizeSendTime` |
| Applied in Live DB | **NOT VERIFIED** | Migration file ≠ applied |

### 9) Birthday popup / campaign management

| Item | Status | Evidence |
|------|--------|----------|
| Dedicated Admin “common birthday popup” campaign UI for T02 | **Not as dedicated product** | Birthday Notifications card explicitly: “In-app birthday popup is unchanged” (`dashboard-tabs.tsx` ~4046–4047) |
| In-app announcements birthday template flags | **Present** | `is_birthday_template`, `birthday_personalize_name` in announcements admin panel + APIs |
| Guarantees common once/day + personal every-open | **NOT VERIFIED / not Admin-owned** | Requires Mobile + announcement runtime (out of scope) |

### 10) API routes and server-side functions

| Route | Purpose | HEAD auth | Main auth |
|-------|---------|-----------|-----------|
| `PUT .../users/[id]/birth-date` | Update `birth_date` | `members.edit` | `requireAdminApi` |
| `GET/PUT .../birthday-notification-settings` | Config | view/manage | `requireAdminApi` |
| `GET .../birthday-notification-status` | Today count / logs | `birthday.view` | session-only (main) |
| `POST .../birthday-notification-test` | Force send proxy | `birthday.manage` | session-only (main) |

### 11) Edge Function invocation and integration

| Item | Status | Evidence |
|------|--------|----------|
| Source in Admin repo | **Present** | `supabase/functions/send-birthday-notification/index.ts` |
| Admin test proxy invokes EF | **Present** | `birthday-notification-test/route.ts` → `POST ${supabaseUrl}/functions/v1/send-birthday-notification` |
| Send model | **Per birthday user** blast to all devices | `processBirthdayUser` body: `Today is ${name}'s birthday!…` (~466–470) — **not** one push listing all names |
| Cap | 25 birthdays per run | Documented in `BIRTHDAY_NOTIFICATION_IMPLEMENTATION.md` |
| Deployed to project | **NOT VERIFIED** | Docs say manual deploy |

### 12) Database DOB source references

| Object | Status |
|--------|--------|
| `list_users_with_birthday_on(p_date)` | Uses `birth_date` month/day match |
| `birthday_notification_logs` | Idempotency per user/date/key |
| RLS on settings/logs | Defined in migration (service_role execute on RPC) |
| Applied to staging/prod | **NOT VERIFIED** |

### 13) Scheduled job / cron integration

| Item | Status | Evidence |
|------|--------|----------|
| Cron SQL template | **Present** | `supabase/ops/052_birthday_notification_cron.sql` — `*/5 * * * *` → EF |
| Placeholders | Must replace `<SUPABASE_URL>` / `<SERVICE_ROLE_KEY>` | Not auto-applied |
| Live cron exists | **NOT VERIFIED** | Docs: manual after review; prior A11 noted Live `pg_cron` uncertainty |

### 14) Tests and safe non-destructive results

| Test | Result | Coverage |
|------|--------|----------|
| `test:admin-rbac-a13` | **PASS** | Birthday permission string gates on HEAD |
| `test:admin-rbac-a13-hardening` | **PASS** | birth-date UUID + safe errors |
| `test:admin-dashboard-a21` | **PASS** | `birthday.view` SSR gating references |
| Runtime FCM / cron / DB | **NOT RUN** | Would touch Live/staging |

---

## 5. Mapping to A1–A25 (Admin)

| A-task | Relationship to Admin T02 | Completes T02? |
|--------|---------------------------|----------------|
| **A13** | Adds `birthday.view` / `birthday.manage` and `members.edit` on DOB route (A21 branch) | **No** — RBAC only; not merged to main |
| **A20** | Mobile FCM/session (not Admin) | **No** |
| **A21** | Dashboard SSR gates include `canViewBirthday` | **No** — perf/RBAC shell only |
| **A24** | Membership inventory/parser | **No** direct T02 link |

Birthday **feature** itself predates A13–A21 (merged via birthday DOB + notification commits on main).

---

## 6. Client T02 criteria vs Admin delivery

Client T02 asks for:

1. **Daily collective push with all birthday names** → Admin EF sends **separate** “Today is {Name}'s birthday” blasts → **FAIL / PARTIAL**
2. **Common birthday popup once per day** → Admin does not own a dedicated T02 common popup; announcements flags only → **NOT VERIFIED / incomplete**
3. **Personal popup every app open** → Mobile → **out of Admin scope** (Admin explicitly leaves popup unchanged)

Admin **does** deliver ops prerequisites: DOB maintenance (`birth_date`), enable/time config, test/status, schema/EF/cron **source**.

---

## 7. Acceptance criteria checklist (Admin-scoped)

| ID | Criterion | Result |
|----|-----------|--------|
| A-T02-01 | Admin can view member DOB | **PASS** (`birth_date`; also shows `date_of_birth`) |
| A-T02-02 | Admin can add/edit authoritative DOB used by automation | **PASS** (`birth_date` via Birthday tab + API) |
| A-T02-03 | Single unambiguous DOB field in Admin UI | **FAIL** (duplicate labels/columns) |
| A-T02-04 | DOB validation `YYYY-MM-DD`, not future | **PASS** |
| A-T02-05 | Add Member form includes DOB | **FAIL / N/A** (no Admin add-member DOB form found) |
| A-T02-06 | Birthday Admin tab + filters | **PASS** |
| A-T02-07 | Notification enable + send_time config | **PASS** (source) |
| A-T02-08 | Permission-gated birthday ops on release main | **PARTIAL** — hardened on A21, weak on `origin/main` |
| A-T02-09 | Test/status tooling for birthday FCM | **PASS** (source) |
| A-T02-10 | Collective single push with all names | **FAIL** |
| A-T02-11 | Admin-managed common once/day popup meeting T02 | **FAIL / NOT VERIFIED** |
| A-T02-12 | Cron + EF proven in staging/prod | **NOT VERIFIED** |
| A-T02-13 | Migration 051 applied | **NOT VERIFIED** |

**Admin T02 cannot be COMPLETE** while A-T02-03, A-T02-10, A-T02-12 fail/unverified.

---

## 8. Exact remaining Admin development work

### Priority 1 — Data integrity / security
1. **Unify DOB UI to `birth_date` only** (T27 overlap): remove or deprecate display of `date_of_birth` in Users table, export, and `admin-user-profile-sections.tsx`; optional one-time data reconciliation report (read-only SQL) before any write migration.
2. **Merge A13 birthday RBAC to Admin `origin/main`** (from `fix/dashboard-performance-rbac-a21-20261102`): ensure birth-date uses `members.edit`; settings/status/test use `birthday.view` / `birthday.manage`. Resolve A3/A7 regressions on that branch before production merge (separate security finding).

### Priority 2 — T02 product gap owned partly by Admin/backend
3. If client requires **one collective push listing all names**, change `send-birthday-notification` send model (and Admin copy that currently describes per-person winner-style blasts). Coordinate with Mobile; Admin test button behavior must match.
4. If Admin must manage **common birthday popup**, define announcement/campaign rules for once-per-day common content (beyond raw `is_birthday_template` checkbox) and document Mobile contract.

### Priority 3 — Ops verification (no code required first)
5. Confirm staging: migration `051` applied, EF deployed, cron job scheduled, one dry-run status/test.
6. Document Live enablement checklist using `supabase/ops/birthday_notification_verification.sql`.

### Priority 4 — Forms (if product requires)
7. Only if required: Admin Add Member / Edit Member form DOB bound solely to `birth_date`.

---

## 9. Finding register (summary)

| # | Severity | Finding | Path / function | Branch/SHA | Pushed | Merged main | Tests |
|---|----------|---------|-----------------|------------|--------|-------------|-------|
| F1 | Medium | Dual DOB columns confuse ops; automation uses only `birth_date` | `dashboard-tabs.tsx`, `admin-user-profile-sections.tsx` | main + HEAD | Yes | Yes | Source |
| F2 | High (main) | Birthday/DOB APIs session-only on main | birth-date + birthday-notification-* on `origin/main` | `a88a6b3` | Yes | Yes | A13 tests apply to HEAD only |
| F3 | Medium | Collective multi-name push not implemented | `send-birthday-notification` `processBirthdayUser` | main | Yes | Yes (source) | Docs |
| F4 | Medium | Cron/EF Live enablement unknown | `052_*.sql`, EF source | main | Yes | Source only | NOT VERIFIED |
| F5 | Low | No Admin Add-Member DOB form | — | — | — | — | Source absence |
| F6 | Info | A13 RBAC improvements exist but unmerged | A21 @ `1b0c9a4` / `36aaa40` | Pushed | **No** | Static PASS on HEAD |

---

## 10. Final status statement

**Admin T02 status: PARTIALLY COMPLETE**

- Birthday Admin tooling and `birth_date`-based notification pipeline **source** are on **Admin `origin/main`** (merged historically).
- Client T02 acceptance is **not** met by Admin alone (collective push format, popup behaviors, Live cron/EF proof, single DOB field).
- Permission hardening for birthday/DOB is **CODE COMPLETE – NOT MERGED** on the A21 branch relative to main.

