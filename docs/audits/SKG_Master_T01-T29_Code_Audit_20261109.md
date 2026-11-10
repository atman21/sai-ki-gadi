# SKG Master Code Audit — Client Tasks T01–T29

**Audit date:** 2026-11-09  
**Mode:** Read-only evidence-based code audit  
**Repos:** `/var/www/html/sai-ki-gadi-app` (Mobile), `/var/www/html/merigaadiwebsite` (Admin)  
**Limits:** `gh` unavailable; staging/production runtime NOT VERIFIED; migration apply NOT VERIFIED; remote main tip may differ from local without fetch.

## Executive Summary

| Status | Count |
|---|---:|
| COMPLETE | 2 |
| CODE COMPLETE – NOT MERGED | 0 |
| PUSHED – PR NOT MERGED | 0 |
| PARTIALLY COMPLETE | 11 |
| NOT IMPLEMENTED | 15 |
| REGRESSED / BROKEN | 1 |
| NOT VERIFIED | 0 |

**COMPLETE:** T19 (Exchange WhatsApp template — source), T24 (Booking Points profile entry — source).

**REGRESSED / BROKEN:** T07 (Exchange Mark Booked stay-in-feed broken by A18 feed filter).

**Critical finding:** A18 fare-masking exchange feed `WHERE booked=false AND cancelled_at is null` conflicts with client T07/T08 retention requirements and with earlier `cancellation-feed-status` expectations.

A1–A25 is mostly a security/hardening program. It does **not** deliver most T01–T29 product requirements. Mapping details are in the Excel cross-reference sheet.

## T01–T29 Complete Audit

| Task | Final Status | Related A1–A25 | Remaining Work |
|---|---|---|---|
| T01 — Lucky Draw Daily Notifications | **PARTIALLY COMPLETE** | A19 (prize lots/expiry), A20 (FCM plumbing) — partial overlap only | Implement scheduled daily push + once/day popup + 7-day countdown + stop when used/expired; verify EF schedule |
| T02 — Birthday Automation | **PARTIALLY COMPLETE** | A13 (birthday RBAC), A20 (FCM) — infrastructure only | Unify collective push format; common once/day popup; personal every-open behavior; single DOB source (T27) |
| T03 — City Name Only | **NOT IMPLEMENTED** | A21 cities notes only (weak) | Create city display helper (city-only); apply across all listed surfaces; keep state storage |
| T04 — Manage History Speed | **PARTIALLY COMPLETE** | A21 Admin perf (different scope) | Add server pagination / query limits for Manage History; keep Active/Past fast after load |
| T05 — Trip Confirm With Label | **NOT IMPLEMENTED** | — | Update labels + en/hi/gu locale keys for Single and Exchange |
| T06 — Exchange Assigned Car & Notes | **NOT IMPLEMENTED** | Track C / historical Draft PR #44 claim (migration 20261029190000) — file NOT found in repo | Add Exchange columns/RPC/UI + RLS for authorized members only; do not reuse broken Track C draft without review |
| T07 — Exchange Mark Booked | **REGRESSED / BROKEN** | — (A18 fare feed RPC conflict) | Remove Exchange feed booked/cancelled exclusion (or match Single); keep contact gating; add regression test against A18 RPC |
| T08 — Mark Cancelled & Blue Badge | **PARTIALLY COMPLETE** | — | Fix Exchange feed retention (same as T07); verify contact hide for unauthorized |
| T09 — Assigned Trip History | **NOT IMPLEMENTED** | A17 trip-points only (not UI) | Replace label/layout in history + assigned-trips; add i18n GU/HI/EN |
| T10 — Home Profile Button | **PARTIALLY COMPLETE** | — | Remove Profile quick link; add Profile label above avatar |
| T11 — Check Review Navigation | **NOT IMPLEMENTED** | A13 fraud RBAC (Admin only) | Rename strings all locales; remove Suvidha entry; enable Home quick action |
| T12 — Add Review | **NOT IMPLEMENTED** | A13 fraud RBAC only | Design/implement member review schema+UI+Admin moderation (distinct from fraud reports) |
| T13 — Membership Text Change | **NOT IMPLEMENTED** | A15/A24 membership enum/parser (not copy) | Replace copy with approved text; add en/hi/gu keys |
| T14 — Five Booking Notification Sounds | **NOT IMPLEMENTED** | A20 FCM lifecycle only | Add 5 sounds, picker UI, persistence, first-open prompt, server channel mapping |
| T15 — Hide Billing & Invoices | **PARTIALLY COMPLETE** | — | Hide/remove menu row only (feature flag); do not delete billing modules |
| T16 — Driver Tabs Order | **PARTIALLY COMPLETE** | — | Swap tab order only |
| T17 — Car Available & Membership Access | **PARTIALLY COMPLETE** | A13/A15/A18 weak overlap | Unhide tab; add membership check client+RLS/RPC; allow view for signed-in eligible members |
| T18 — One Profile Reference | **PARTIALLY COMPLETE** | — | Unify display to one Name-Number; remove Ref-1/2 labels from edit/profile; keep columns |
| T19 — Exchange WhatsApp Template | **COMPLETE** | — | Optional: compare byte-for-byte to approved marketing template; device share smoke test |
| T20 — Complete Three-Language Support | **PARTIALLY COMPLETE** | — | Screen-by-screen localization; remove hardcoded strings; expand gu/hi keys |
| T21 — Disallowed Reference Numbers | **NOT IMPLEMENTED** | — | Add normalized denylist client+server; exact error string; regression test login still works |
| T22 — Profile Menu Navigation | **PARTIALLY COMPLETE** | — | Add Notification Settings screen/entry (T14/T26); remove duplicates if any appear after changes |
| T23 — My Cars Owner Details | **NOT IMPLEMENTED** | — | Migration + forms + Admin display + RLS/permissions |
| T24 — Booking Points Profile Entry | **COMPLETE** | A17/A23 backend only | Optional device smoke test of navigation |
| T25 — City Preference UI | **NOT IMPLEMENTED** | A21 cities notes weak | Copy + ordering changes only |
| T26 — Driver Requirement Notification Settings | **NOT IMPLEMENTED** | A20 plumbing only | Add preference column/RPC + settings UI + fixed sound channel isolation |
| T27 — Admin Date of Birth Field | **NOT IMPLEMENTED** | A13 birthday RBAC limited | Remove duplicate field/UI; standardize on birth_date; migrate/display cleanup |
| T28 — Admin Disputed Numbers | **NOT IMPLEMENTED** | A13 fraud RBAC only (different) | Full new Admin module + Storage privacy + signup pending UI; no auto-reject |
| T29 — SKG AI Help Center | **NOT IMPLEMENTED** | — | Greenfield feature with security/privacy review; server-side quota enforcement mandatory |

## Coverage vs A1–A25

- **Satisfied by A-program (source):** essentially none of T01–T29 end-to-end; T19/T24 exist outside A-scope.
- **Partially overlapped by A-program:** T01(A19/A20), T02(A13/A20), T07/T08(A18 conflict), T14/T26(A20 plumbing), T17(A15 weak), T18(signup work independent), T27(A13 birthday RBAC weak).
- **Not covered by A1–A25:** T03,T05,T06,T09–T13,T15,T16,T20–T23,T25,T28,T29 (and most UX criteria of others).

## GitHub / Branch Notes

- Mobile client feature code for these T-tasks generally lives on **mobile `origin/main`** (as current product), not on dedicated T0x branches.
- Admin security work for related concerns is on **`fix/dashboard-performance-rbac-a21-20261102` (pushed, NOT merged to Admin main)**.
- Historical Track C Draft PR #44 for Exchange notes: **not verifiable here** (`gh` missing; migration file absent).

## Recommended Remaining Work (priority)

- **P1 / T07:** Fix Exchange feed retention + contact gating regression — `supabase/migrations/*fare_masking* exchange feed WHERE; exchange.tsx; add regression test`
- **P1 / T08:** Align Exchange cancel retention with Single — `Same as T07; requests.tsx already blue badge`
- **P1 / T21:** Add normalized reference denylist client+Edge — `lib/signup-profile-fields.ts; send-reference-otp; new tests`
- **P1 / T06:** Design Exchange notes/car with RLS authorized-only — `New migration + exchange history UI; do not revive unverified PR#44 blindly`
- **P1 / Admin release hygiene:** Restore A3/A7 before Admin feature work T27/T28 — `admin-auth.ts; admin-identity-documents ownership; A21 branch`
- **P2 / T05:** Rename Trip confirm with + i18n — `exchange/history.tsx; requirements/history.tsx; i18n locales`
- **P2 / T09:** Assigned trip history label — `requirements/history.tsx; assigned-trips.tsx; i18n`
- **P2 / T17:** Unhide cab-avail + Gold/Diamond server gate — `tabs/_layout.tsx; app-floating-tab-bar.tsx; cab-avail RLS/RPC`
- **P2 / T04:** Paginate Manage History — `requirements/history + exchange history services`
- **P3 / T01:** Daily credit reminder push+popup+countdown — `New scheduler/EF + mobile host; reuse A19 lot status`
- **P3 / T02:** Complete birthday automation behaviors — `send-birthday-notification; birthday-wish-host; announcements`
- **P3 / T14:** Five booking sounds + settings — `notification-channel; account notification settings; assets/sounds`
- **P3 / T26:** Driver requirement toggle + fixed sound — `new preference + push-recipient-filter + settings UI`
- **P4 / T27:** Single DOB field — `admin-user-profile-sections.tsx; dashboard-tabs; schema`
- **P4 / T28:** Disputed Numbers module — `new Admin tab/API/storage + pending badge`
- **P5 / T03:** City-only display helper — `nominatim + all feed/history/WhatsApp formatters`
- **P5 / T10:** Home profile UI — `home.tsx`
- **P5 / T11:** Check Review nav — `suvidha/index.tsx; home.tsx; i18n`
- **P5 / T13:** Diamond membership copy — `account/membership.tsx; i18n`
- **P5 / T15:** Hide billing menu — `account/index.tsx`
- **P5 / T16:** Swap driver tabs — `drivers.tsx`
- **P5 / T18:** One reference display — `edit-profile; account-style-profile-sheet`
- **P5 / T20:** Finish localization — `i18n locales + hardcoded screens`
- **P5 / T22:** Notification Settings entry — `account/index.tsx + new screen`
- **P5 / T25:** City preference copy/order — `account/[slug].tsx`
- **P6 / T12:** Member reviews system — `new tables/UI/Admin moderation`
- **P6 / T23:** Car owner fields — `037_user_vehicles + my-cars forms + Admin`
- **P6 / T29:** SKG AI Help Center — `greenfield mobile+admin+server quotas`

## Deliverables

- Excel: `/var/www/html/merigaadiwebsite/docs/audits/SKG_Master_T01-T29_Code_Audit_20261109.xlsx`
- Markdown: `/var/www/html/merigaadiwebsite/docs/audits/SKG_Master_T01-T29_Code_Audit_20261109.md`
