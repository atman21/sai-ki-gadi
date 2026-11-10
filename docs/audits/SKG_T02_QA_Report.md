# SKG T02 – Birthday Automation QA Report (Consolidated)

**QA date:** 2026-11-10  
**Mode:** READ-ONLY (no code/migration/deploy/commit changes)  
**Mobile repo:** `/var/www/html/sai-ki-gadi-app` branch `hannan`  
**Admin repo:** `/var/www/html/merigaadiwebsite` branch `fix/dashboard-performance-rbac-a21-20261102`  
**Compared claims against:**  
- `docs/audits/SKG_T02_Full_Implementation_Report.md`  
- `sai-ki-gadi-app/docs/audits/SKG_T02_Mobile_Implementation_Report.md`

---

## Executive recommendation

### **READY FOR STAGING MANUAL QA** — with hard prerequisites

T02 **is not fully complete**. Source on the current working trees implements the main Mobile + Admin contracts and mocked tests pass, but:

1. Additive migration / RPC / digest tables are **not applied** anywhere (NOT VERIFIED).  
2. Collective Edge Function is **not deployed** (NOT VERIFIED).  
3. Mobile has a **TypeScript compile error** on birthday navigation (`router.push("/(app)")`).  
4. Admin granular birthday RBAC exists on **A21 HEAD**, **not** on `origin/main`.  
5. Admin Add Member DOB form remains **missing**.  
6. `birthday_personalize_name` is **not honored** in Mobile renderer.

Do **not** claim Production readiness. Staging manual QA can proceed after the prerequisites in §11.

---

## Evidence tiers used in this report

| Tier | Meaning |
|------|---------|
| **Source verified** | Inspected in working tree |
| **Static/mocked test verified** | Unit/static suite PASS |
| **Staging runtime verified** | Never in this QA |
| **Production runtime verified** | Never (forbidden) |

Status vocabulary: **PASS / FAIL / BLOCKED / NOT RUN / NOT VERIFIED**

---

## 1. Claim vs source verification (implementation reports)

| Claim | Evidence | QA |
|-------|----------|----|
| Personal popup uses `users.birth_date` | `services/users/birthday.service.ts:12–16` select `birth_date` | **PASS** (source) |
| Asia/Kolkata + leap year | `lib/birthday-utils.ts:8–83` | **PASS** (source + unit) |
| Cold open once; no resume re-show personal | `birthday-wish-host.tsx:156–218` (`startColdOpen` + AppState only forces list) | **PASS** (source) |
| Common list popup | `components/birthday-list-popup.tsx`, host wiring | **PASS** (source); runtime **NOT VERIFIED** |
| List once/IST day AsyncStorage | `lib/birthday-list-storage.ts`, policy | **PASS** (source); persist across restart **NOT VERIFIED** (device) |
| Birthday FCM ≠ Lucky Draw | `app/_layout.tsx:104–114`, `lib/birthday-notification-nav.ts` | **PASS** (source); live FCM **NOT VERIFIED** |
| Skip birthday announcements if popup shown | `in-app-announcement-host.tsx:67–78` | **PASS** (source); race risk §3 |
| `birthday_personalize_name` honored | Only in `types.ts:53`; unused in renderer | **FAIL** |
| Collective digest EF | Working-tree EF uses `formatBirthdayDigestBody` + digests | **PASS** (source on A21 WT) |
| Collective EF on Admin `origin/main` | `origin/main` still `processBirthdayUser` per-person | **FAIL** vs main |
| DOB UI single field | Profile/export/users table prefer `birth_date` | **PASS** (source) with fallback residual risk |
| Birth-date API `members.edit` | HEAD yes; `origin/main` uses `requireAdminApi()` only | **PASS** on A21; **FAIL** if judging main |
| Add Member DOB | No create-member form found | **BLOCKED** / gap |
| Migration applied | Source only | **NOT VERIFIED** |
| Cron live | `052` template with placeholders | **NOT VERIFIED** |

---

## 2. Automated / static execution results

| Command | Result |
|---------|--------|
| Mobile `npm run test:birthday-t02` | **PASS** 5/5 |
| Mobile `npm run test:notification-fcm-session-a20` | **PASS** 10/10 |
| Mobile `git diff --check` | **PASS** |
| Mobile `tsc` (birthday filter) | **FAIL** — `lib/birthday-notification-nav.ts:48` typed routes reject `"/(app)"` |
| Admin `npm run test:birthday-t02` | **PASS** |
| Admin `npm run test:admin-rbac-a13-hardening` | **PASS** (static; HTTP matrix NOT RUN) |
| Admin `npm run test:admin-dashboard-a21` | **PASS** (static; live HTTP NOT RUN) |
| Admin `git diff --check` | **PASS** |
| Admin `npm run lint` | **FAIL** — EF `@ts-nocheck` ban + other pre-existing warnings |

All suite results above are **mocked/static**, not Staging runtime.

---

## 3. Bugs / defects found

| ID | Severity | Area | Finding |
|----|----------|------|---------|
| B1 | **High** | Mobile build | `navigateToBirthdayFromNotification` → `router.push("/(app)")` fails Expo Router typed routes (`lib/birthday-notification-nav.ts:48`). |
| B2 | **High** | Announcements | `birthday_personalize_name` never applied in `in-app-announcement-renderer.tsx` (only typed). |
| B3 | **Medium** | Announcement race | `InAppAnnouncementHost` mounts **before** `BirthdayWishHost` (`app/(app)/_layout.tsx:44–45`). First `app_open` fetch can occur before `markPersonalBirthdayShown`, so a birthday template may still display alongside personal popup. |
| B4 | **Medium** | Admin data | Birthday tab filter uses **only** `birth_date` (`dashboard-tabs.tsx:1515`). Members with DOB only in legacy `date_of_birth` are invisible to birthday ops. |
| B5 | **Medium** | Admin merge | `origin/main` birthday APIs still session-gated (`requireAdminApi`); collective EF **not** on main. Merging A21 without review risks shipping unrelated A21 changes; **not** merging leaves insecure/outdated birthday APIs on main. |
| B6 | **Low** | List empty UX | Normal path returns early when `names.length === 0` (`birthday-wish-host.tsx:86`); empty-state UI rarely shown except force/error paths. |
| B7 | **Low** | Lint | `send-birthday-notification/index.ts` uses `@ts-nocheck` → ESLint error. |
| B8 | **Info** | List membership | `list_today_birthday_names` includes **all** today’s birthdays (including current user). Product include/exclude rule not encoded. |

---

## 4. Missing requirements / gaps

1. Admin **Add Member** DOB create flow — still absent.  
2. Staging apply of `20261110120000_birthday_digest_and_list_names.sql`.  
3. Deploy collective `send-birthday-notification` + `BIRTHDAY_PUSH_DELIVERY` env.  
4. Cron `052` placeholders / live job existence.  
5. End-to-end FCM foreground/background/cold-start on device.  
6. `birthday_personalize_name` product behavior.  
7. Safe `date_of_birth` → `birth_date` backfill (ops plan exists; not run).  
8. WhatsApp birthday (older notes) — out of scope / not implemented.

---

## 5. Regression risks

| Risk | Notes |
|------|-------|
| Lucky Draw FCM | Birthday branch returns before Lucky Draw resolve (`app/_layout.tsx:104–114`) — source OK; device **NOT VERIFIED** |
| Generic `onMessage` local notify | Still schedules local notification for any title/body including birthday — expected tray behavior; birthday music not used (good) |
| Admin Users table colspan | Removed one DOB column — verify no header/body mismatch on live UI (source looks aligned) |
| Dual log tables | Legacy `birthday_notification_logs` + new digests; status API falls back — OK if migration applied |
| A21 merge surface | Large branch; birthday RBAC should not be merged blindly without A21 security review |

---

## 6. A21 / security status

| Check | Result |
|-------|--------|
| HEAD birth-date permission | `requireAdminPermission("members.edit")` — `birth-date/route.ts:16` |
| HEAD settings permissions | `birthday.view` / `birthday.manage` |
| `origin/main` birth-date | `requireAdminApi()` only — **weaker** |
| `origin/main` settings | `requireAdminApi()` only — **weaker** |
| A21 contained in `origin/main`? | **No** (`merge-base` ancestor check failed) |
| Unauthorized HTTP 401/403 matrix | **NOT RUN** |
| Live Production auth | **NOT RUN** (forbidden) |

**Recommendation:** Do not merge A21 wholesale solely for T02. Cherry-pick or isolate birthday RBAC + T02 digest changes after A21 security review.

---

## 7. Database / Edge / Cron QA (source only)

| Artifact | Source verified | Staging | Production |
|----------|-----------------|---------|------------|
| `051_birthday_notifications.sql` | Present (settings + logs + `list_users_with_birthday_on`) | NOT VERIFIED | NOT VERIFIED |
| `052_birthday_notification_cron.sql` | Template with `<SUPABASE_URL>` / `<SERVICE_ROLE_KEY>` | NOT VERIFIED | NOT VERIFIED |
| `20261110120000_birthday_digest_and_list_names.sql` | Additive digests + `list_today_birthday_names`; does not drop logs | NOT VERIFIED | NOT VERIFIED |
| Collective EF | Digest body, `notification_type=birthday`, delivery gate, reclaim logic | NOT VERIFIED | NOT VERIFIED |
| Idempotency | `success` digest skipped; device hash successes not resent; `partial`/`failure` reclaimable | Source PASS | — |
| Duplicate FCM risk | Unrecorded success (FCM OK, DB write fail) may retry → possible duplicate to that device | Source risk documented | — |
| Production ref refusal | Gate refuses `uecdmytikvwiosnyndxe` | Source PASS | — |

---

## 8. Manual QA checklist

Leave **Actual** and **PASS/FAIL** blank for the human tester.

### 8.1 Mobile (local Metro / device — partially without Staging)

| ID | Feature | Before | After expected | Preconditions | Steps | Expected | Actual | P/F | Sev |
|----|---------|--------|----------------|---------------|-------|----------|--------|-----|-----|
| M-01 | Personal popup DOB | Fixed/session behavior | Shows only if own `birth_date` is today IST | User with today’s DOB; Metro Staging URL | Login cold start | Personal popup once | | | |
| M-02 | Missing DOB | N/A | No personal popup | User `birth_date` null | Cold start | No personal popup | | | |
| M-03 | Resume duplicate | Could re-check | No second personal on resume | After M-01 close popup | Background → foreground | No personal re-show | | | |
| M-04 | Kill reopen | Session flag | May show again (cold open) | Same birthday user | Force-stop app, reopen | Personal may show again | | | |
| M-05 | User switch | N/A | State resets | Two accounts, one birthday today | Logout/login other | Correct popup per user | | | |
| M-06 | Music/confetti | Present | Still works | M-01 | Observe audio + confetti | Music + confetti | | | |
| M-07 | EN/HI/GU wish | Present | Localized | Change app language | Open popup | Correct language | | | |
| M-08 | List after personal | Missing | List after close if names exist | **Staging RPC applied**; ≥1 birthday today | Close personal | List appears once | | | |
| M-09 | List once/day | Missing | No second list same IST day | After M-08 | Kill/reopen same day | No list (or only personal) | | | |
| M-10 | List empty day | Missing | No list / empty handling | No birthdays today; RPC applied | Cold start | No erroneous list | | | |
| M-11 | List i18n | Missing | Localized title/close | HI/GU locale | Open list | Translated | | | |

**Requires Staging deploy:** M-08–M-11 (RPC). M-01–M-07 can run if Staging already has `birth_date` data.

### 8.2 Birthday FCM (requires Staging EF + device)

| ID | Feature | Before | After expected | Preconditions | Steps | Expected | Actual | P/F | Sev |
|----|---------|--------|----------------|---------------|-------|----------|--------|-----|-----|
| F-01 | Payload type | N/A | `notification_type=birthday` | EF deployed + delivery env | Trigger test/cron | Payload has type+route | | | |
| F-02 | Foreground tray | Generic FCM | Local notify; no Lucky Draw nav | App foreground | Receive push | Tray shown; no winners nav | | | |
| F-03 | Background tap | N/A | Opens app + forces list | App background | Tap notification | List (or shell) not winners | | | |
| F-04 | Cold start tap | N/A | Same as F-03 | App killed | Tap notification | Birthday path | | | |
| F-05 | Lucky Draw regression | Worked | Still opens winners | Lucky Draw push | Tap LD notification | `/(app)/winners` | | | |
| F-06 | Collective body | Per-person blasts | One body listing names | ≥2 birthdays | Inspect notification text | Single digest copy | | | |
| F-07 | Duplicate daily | Per-user logs | Second cron no re-blast after success | After success digest | Wait next cron tick | Skipped already_sent | | | |

### 8.3 Admin Web

| ID | Feature | Before | After expected | Preconditions | Steps | Expected | Actual | P/F | Sev |
|----|---------|--------|----------------|---------------|-------|----------|--------|-----|-----|
| A-01 | Birthday tab `birth_date` | Dual labels | Filter/table use `birth_date` | Admin with `birthday.view` | Open Birthday tab | Correct members | | | |
| A-02 | Edit DOB save | Works | Writes `birth_date` only | `members.edit` | Add/Edit DOB save | API updates `birth_date` | | | |
| A-03 | Users export DOB | Two columns | One Date of Birth from birth_date (±fallback) | Users tab | Export Excel | Single DOB column | | | |
| A-04 | Profile DOB | Two fields | One Date of Birth | Open profile | View DOB | Single field | | | |
| A-05 | DOB validation | Present | Reject future/invalid | Edit DOB | Enter invalid date | 400 / UI error | | | |
| A-06 | Add Member DOB | Missing | Still missing | Look for create member | Confirm no form | Gap confirmed | | | |
| A-07 | Settings enable/time | Present | Saves with `birthday.manage` | Manage permission | Toggle + save | Persists | | | |
| A-08 | Status card | Logs-based | Digest-aware if migration applied | Migration applied | Open status | Digest mode fields | | | |
| A-09 | Test send | Present | Proxies EF; respects delivery gate | EF + secrets | Click test | Documented behavior | | | |
| A-10 | Unauthorized DOB | Main weak | 403 without `members.edit` on A21 | Role without edit | PUT birth-date | 403 | | | |
| A-11 | Unauthorized settings | Main weak | 403 without birthday.* | Role without birthday | GET/PUT settings | 403 | | | |

### 8.4 Database / Edge / Cron (Staging)

| ID | Feature | Steps | Expected | Actual | P/F |
|----|---------|-------|----------|--------|-----|
| D-01 | Apply additive migration | Review + apply `20261110120000_…` on Staging only | Digests tables + RPC exist | | |
| D-02 | RPC smoke | `select * from list_today_birthday_names();` as authenticated | Names only | | |
| D-03 | Deploy EF | Deploy from Admin/Mobile mirror | Function version updated | | |
| D-04 | Delivery gate | Call without `BIRTHDAY_PUSH_DELIVERY` | `delivery_disabled` skip | | |
| D-05 | Staging mode | `staging` + test tokens | Only allowlisted devices | | |
| D-06 | Cron | Inspect `cron.job` for birthday job | Exists; Lucky Draw untouched | | |
| D-07 | Empty day | Run with zero birthdays | `no_birthdays` skip | | |

### 8.5 Regression / Security

| ID | Area | Steps | Expected |
|----|------|-------|----------|
| R-01 | Mobile login OTP | Send/verify OTP | Unaffected |
| R-02 | Non-birthday announcements | Open app non-birthday | Still show |
| R-03 | Booking FCM | Receive booking push | No birthday nav |
| S-01 | Confirm not on Prod | No Prod migrate/deploy | Confirmed |
| S-02 | A21 vs main | Diff birthday routes | Document merge plan |

---

## 9. Staging prerequisites (gate before meaningful runtime QA)

1. Fix Mobile TS route push (B1) before release builds.  
2. Apply `20261110120000_birthday_digest_and_list_names.sql` on **Staging only**.  
3. Deploy collective `send-birthday-notification` to Staging.  
4. Set non-prod `BIRTHDAY_PUSH_DELIVERY` (+ test tokens for `staging` mode).  
5. Verify/create cron from `052` with Staging URL/key placeholders replaced.  
6. Point Mobile + Admin clients at Staging.  
7. Optionally backfill null `birth_date` from `date_of_birth` using ops plan (reviewed SELECT first).

---

## 10. Acceptance criteria evidence summary

| ID | Criterion | QA status |
|----|-----------|-----------|
| C1 | Authoritative `birth_date` | **PASS** source (residual legacy field) |
| C2 | Admin DOB edit/search | **PASS** source; Add Member **BLOCKED** |
| C3 | Settings + RBAC | **PASS** on A21 WT; **FAIL** on `origin/main` |
| C4 | Collective push | **PASS** source WT; runtime **NOT VERIFIED**; main **FAIL** |
| C5 | Personal popup | **PASS** source + unit |
| C6 | Common list | **PASS** source; runtime **NOT VERIFIED** |
| C7 | Cold-open policy | **PASS** source + unit |
| C8 | Birthday FCM | **PASS** source; TS **FAIL**; runtime **NOT VERIFIED** |
| C9 | Dedup coordination | **PARTIAL** (race B3; personalize B2) |
| C10 | IST/leap | **PASS** unit |
| C11 | Automated tests | **PASS** mocked suites |
| C12 | Staging runtime | **NOT VERIFIED** |

---

## 11. Final verdict

**READY FOR STAGING MANUAL QA** after prerequisites in §9.

**Not ready** to mark T02 complete, merge to Production, or skip device/Staging proofs.

Companion Mobile detail report: `/var/www/html/sai-ki-gadi-app/docs/audits/SKG_T02_QA_Report.md`
