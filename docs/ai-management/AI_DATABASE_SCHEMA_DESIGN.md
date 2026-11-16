# SKG AI Management — Additive Database Schema Design

**Phase:** 1 (design only — **no migration created for these future tables**)  
**Date:** 2026-11-16  
**Rule:** Additive, backward-compatible. Do not duplicate Mobile T29 FAQ / `skg_ai_*` tables.

## Existing Mobile-owned tables (reuse; do not recreate)

| Table | Admin use later |
|-------|-----------------|
| `help_faq_categories` | FAQ category admin |
| `help_faqs` / `help_faq_translations` | FAQ CRUD + publish |
| `skg_ai_settings` | AI Settings panel |
| `skg_ai_voice_sessions` | Conversations & Sessions (metadata only) |
| `skg_ai_voice_usage_events` | Usage & Analytics |

RLS today: authenticated SELECT published FAQs; settings revoked from authenticated; mutations via `service_role` (Admin APIs).

## Design principles

1. Separate **imported/raw** knowledge from **approved/published** knowledge.  
2. No user PII in knowledge corpus.  
3. Soft deletes / status columns over hard deletes for auditability.  
4. All mutators attributed to `admin_panel_users`.  
5. RLS: no anon; authenticated no write; service_role for Admin; optional authenticated read of **published** knowledge only if Mobile needs it.  
6. Vectors/embeddings optional later — store chunks text first; embedding columns nullable.

---

## A. Knowledge sources — `skg_ai_knowledge_sources`

**Purpose:** Catalog of origins (manual, repo docs, URL, upload).

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `key` | text unique | stable machine key |
| `name` | text | |
| `source_type` | text | `manual` \| `repo` \| `upload` \| `url` \| `faq_bridge` |
| `description` | text null | |
| `is_active` | boolean default true | |
| `created_by` / `updated_by` | uuid → `admin_panel_users` | |
| `created_at` / `updated_at` | timestamptz | |

- **Sensitive:** low (metadata).  
- **RLS:** service_role CRUD; no public read.  
- **Audit:** `help_ai.knowledge_source.*`

---

## B. Knowledge documents & chunks

### `skg_ai_knowledge_documents`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `source_id` | uuid FK → sources | |
| `title` | text | |
| `locale` | text | `en`\|`hi`\|`gu`\|`multi` |
| `status` | text | `draft`\|`in_review`\|`approved`\|`published`\|`archived` |
| `content_sha256` | text | integrity / dedupe |
| `raw_uri` | text null | storage path; never Gemini-facing until published |
| `sensitivity` | text | `public_help`\|`internal`\|`restricted` |
| `created_by` / `updated_by` / `reviewed_by` | uuid null | |
| `published_at` | timestamptz null | |
| `created_at` / `updated_at` | timestamptz | |

### `skg_ai_knowledge_chunks`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `document_id` | uuid FK | on delete cascade |
| `chunk_index` | int | |
| `content` | text | sanitized text only |
| `token_estimate` | int null | |
| `embedding` | vector null | **future**; nullable |
| `is_published` | boolean default false | only published chunks for retrieval |
| `created_at` | timestamptz | |

- **Sensitive:** medium (may contain product docs; forbid PII).  
- **RLS:** service_role; Mobile retrieval via RPC later, not open SELECT.  
- **Audit:** publish/unpublish document.

---

## C. Manual knowledge entries — `skg_ai_manual_knowledge`

**Purpose:** Curated Q&A / facts distinct from Help FAQ (FAQ stays in `help_faqs`).

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `topic` | text | |
| `locale` | text | en/hi/gu |
| `title` | text | |
| `body` | text | |
| `status` | text | draft/in_review/published/archived |
| `feature_key` | text null | booking, exchange, … |
| `created_by` / `updated_by` | uuid | |
| `published_at` | timestamptz null | |
| timestamps | | |

---

## D. Imported source snapshots — `skg_ai_import_snapshots`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `source_id` | uuid FK | |
| `job_id` | uuid FK → import jobs | |
| `snapshot_uri` | text | raw blob location |
| `content_sha256` | text | |
| `byte_size` | bigint | |
| `parser_version` | text | |
| `created_at` | timestamptz | |

**Never** sent to Gemini until promoted through approval → published documents/chunks.

---

## E. Approval & publication versions — `skg_ai_knowledge_versions`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `document_id` | uuid FK | |
| `version_number` | int | unique per document |
| `status` | text | proposed/approved/published/superseded |
| `diff_summary` | text null | |
| `approved_by` | uuid null | |
| `approved_at` | timestamptz null | |
| `published_at` | timestamptz null | |
| `snapshot_json` | jsonb | frozen content metadata (no secrets) |

---

## F–H. Instructions & prompt history

### `skg_ai_instructions`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `scope` | text | `global` \| `feature` |
| `feature_key` | text null | required when scope=feature |
| `locale` | text default `multi` | |
| `title` | text | |
| `body` | text | instruction text |
| `status` | text | draft/published/archived |
| `version` | int | |
| `created_by` / `updated_by` | uuid | |
| timestamps | | |

### `skg_ai_instruction_versions`

Append-only history: `instruction_id`, `version`, `body`, `changed_by`, `change_reason`, `created_at`.

**Sensitive:** medium (prompt text). Never log API keys. Injection review before publish.

---

## I. AI tool registry — `skg_ai_tools` / `skg_ai_tool_policies`

### `skg_ai_tools`

`id`, `key` unique, `name`, `description`, `risk_level` (`low`\|`medium`\|`high`), `is_enabled` default false, timestamps.

### `skg_ai_tool_policies`

`id`, `tool_id` FK, `environment` (`development`\|`staging`\|`production`), `allowed_roles` text[], `requires_confirmation` boolean, `max_calls_per_session` int null.

**Default:** tools disabled until explicitly enabled per environment.

---

## J. AI configuration change history — `skg_ai_settings_changelog`

Append-only mirror of `skg_ai_settings` mutations:

| Column | Type |
|--------|------|
| `id` | uuid PK |
| `changed_by` | uuid → admin_panel_users |
| `before_data` | jsonb |
| `after_data` | jsonb |
| `reason` | text null |
| `created_at` | timestamptz |

Also write `admin_panel_audit_logs` with `help_ai.settings.update` / emergency actions.

---

## K. Knowledge import job history — `skg_ai_import_jobs`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `source_id` | uuid FK | |
| `status` | text | queued/running/succeeded/failed/cancelled |
| `triggered_by` | uuid | |
| `started_at` / `finished_at` | timestamptz null | |
| `error_summary` | text null | scrub secrets |
| `stats` | jsonb | counts only |
| `environment` | text | development/staging/production |

---

## What Phase 1 ships in SQL

**Only** permission seed: `20261116120000_skg_ai_admin_permissions_phase1.sql` (not applied).

**No** CREATE TABLE for A–K in Phase 1.

## Future migration sequencing (recommended)

1. Permissions (Phase 1 source).  
2. Confirm Mobile T29 applied on target env.  
3. Knowledge sources + documents + chunks (draft only).  
4. Instructions + versions.  
5. Tools + policies (disabled).  
6. Import jobs + snapshots.  
7. Settings changelog.  
8. Optional embeddings extension last.
