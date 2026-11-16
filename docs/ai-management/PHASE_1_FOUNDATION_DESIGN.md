# SKG AI Management Console — Phase 1 Foundation Design

**Repository:** Admin Web (`/var/www/html/merigaadiwebsite`)  
**Date:** 2026-11-16  
**Status:** Phase 1 implemented (shell + RBAC catalog + docs). No DB apply / deploy.

## Inputs

- `docs/audits/SKG_AI_ADMIN_ARCHITECTURE_AUDIT.md`
- Mobile companion: `sai-ki-gadi-app/docs/audits/SKG_AI_ARCHITECTURE_AUDIT.md` (**available**)

## 1A — Existing codebase review (integration points)

| Area | Safest integration point |
|------|--------------------------|
| Navigation | `app/dashboard/dashboard-tabs.tsx` `navGroups` + `TAB_KEYS` + `filteredNavGroups` permission filter |
| Icons | `app/dashboard/admin-nav-icons.tsx` `AdminNavTabKey` + `NAV_ICON_CONFIG` |
| Permissions | `lib/admin-permissions.ts` (`ADMIN_PERMISSIONS`, `TAB_PERMISSION_MAP`, `PERMISSION_MODULES`) |
| Nav contract (testable) | New `lib/ai-management-nav.ts` |
| Gate | `requireAdminPermission` in `lib/admin-api.ts` |
| Service role | `lib/supabase-admin.ts` (future FAQ/settings writes only) |
| Audit | `lib/admin-audit.ts` / `admin_panel_audit_logs` (future AI actions) |
| Migrations | Timestamped SQL under `supabase/migrations/` (additive, not applied here) |
| Tests | `scripts/verify-*.mjs` static/unit style |

**Do not** change Mobile Gemini Live mint/voice runtime. FAQ/settings tables stay Mobile-owned.

## 1B — Navigation structure (implemented)

Group title: **SKG AI MANAGEMENT**

| Tab key | Label | View permission | Manage permission |
|---------|-------|-----------------|-------------------|
| `ai-dashboard` | AI Dashboard | `help_ai.view` | — |
| `ai-settings` | AI Settings | `help_ai.manage` | `help_ai.manage` |
| `ai-knowledge-base` | Knowledge Base | `help_ai.view` | `help_ai.manage` |
| `ai-knowledge-import` | Knowledge Import | `help_ai.manage` | `help_ai.manage` |
| `ai-instructions` | AI Instructions | `help_ai.manage` | `help_ai.manage` |
| `ai-faq-help` | FAQ & Help Center | `help.view` | `help.manage` |
| `ai-tools` | AI Tools & Permissions | `help_ai.manage` | `help_ai.manage` |
| `ai-test-assistant` | Test Assistant | `help_ai.manage` | `help_ai.manage` |
| `ai-conversations` | Conversations & Sessions | `help_ai.view` | — |
| `ai-usage` | Usage & Analytics | `help_ai.view` | — |
| `ai-security-audit` | Security & Audit Logs | `help_ai.view` | `help_ai.manage` |

Phase 1 renders `AiManagementPlaceholderPanel` for every AI tab. No Gemini controls.

## 1C — RBAC foundation

Canonical TS keys added: `help.view`, `help.manage`, `help_ai.view`, `help_ai.manage`.

Super Admin: receives all keys via `allPermissionsSet()` / `isSuperAdmin` bypass (`lib/admin-rbac.ts`).

DB seed source (not applied): `supabase/migrations/20261116120000_skg_ai_admin_permissions_phase1.sql`  
Role matrix mirrors Mobile T29 (not broader):

| Role | Grants |
|------|--------|
| `super_admin`, `admin` | all four |
| `manager` | `help.view`, `help.manage`, `help_ai.view` |
| `operator` | `help.view`, `help_ai.view` |

View-only actors can open view tabs; management tabs that require `*.manage` stay hidden via `TAB_PERMISSION_MAP` + `filteredNavGroups`.

Phase 1 API: `GET /api/admin/ai-management/status` requires `help_ai.view`.

## Explicitly out of Phase 1

Knowledge CRUD, imports, Gemini model switching, prompts, RAG, tools, transcripts, analytics queries, Staging/Prod SQL apply, Edge deploys, secret changes.
