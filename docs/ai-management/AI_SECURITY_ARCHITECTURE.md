# SKG AI Management — Security Architecture (Phase 1)

**Date:** 2026-11-16  
**Scope:** Design + Admin shell controls. No Production access. No secret changes.

## 1. Server-only AI provider credentials

| Rule | Detail |
|------|--------|
| Storage | Gemini / provider keys only as Edge Function secrets (`GEMINI_API_KEY`, etc.) |
| Admin Web | Must **never** put provider keys in `NEXT_PUBLIC_*` or browser bundles |
| Admin `.env` | Phase 1 adds no Gemini env vars; future Admin proxies use service-role → Edge only |
| Responses | Never echo keys, ephemeral Live tokens, or raw auth headers |

## 2. Admin API authentication & permission enforcement

| Layer | Mechanism |
|-------|-----------|
| Session | Existing admin session cookie (`lib/admin-session.ts`) |
| Actor | `resolveActorFromSession` + active check |
| Service role | `usingServiceRole` required for privileged Admin APIs |
| Permission | `requireAdminPermission(...)` per route |
| Super Admin | `isSuperAdmin` / `allPermissionsSet()` bypass (existing) |
| Denial | HTTP 403 + `permission_denied` audit |

Phase 1 status route: `GET /api/admin/ai-management/status` → `help_ai.view`.

Nav tabs filtered by `TAB_PERMISSION_MAP` + `adminAccess.can`.

## 3. Knowledge approval before publishing

Pipeline (future):

```
import/raw snapshot → draft document → in_review → approved → published chunks
```

- Imported snapshots are **not** retrieval-eligible.  
- Only `is_published = true` chunks / published manual entries may enter AI context.  
- Dual control: `help_ai.manage` to approve; audit `help_ai.knowledge.publish`.

## 4. Separation: imported vs published

| Store | Gemini / Mobile AI may read? |
|-------|------------------------------|
| `skg_ai_import_snapshots` | **No** |
| Draft documents/chunks | **No** |
| Published chunks / published manual knowledge | **Yes** (via controlled RPC/Edge) |
| FAQ published rows | **Yes** (existing Help FTS; non-LLM path) |

## 5. Prompt injection protections (imported documents)

- Strip / escape instruction-like markup during parse.  
- Store provenance (`source_id`, sha256, parser_version).  
- Treat imported text as **untrusted data**, not system instructions.  
- System/global instructions live only in approved `skg_ai_instructions`.  
- Size limits + MIME allowlists on uploads.  
- Human review required before publish.

## 6. No direct database access for Gemini

Gemini talks only to:

1. Edge mint / Live WebSocket (existing Mobile path), and later  
2. Explicit context payloads built by server code from **published** knowledge.

Gemini never receives DB credentials or service-role keys.

## 7. No private user data in Knowledge Base

Forbidden in knowledge corpus:

- Phone, email, Aadhaar, DL, wallet balances, exact locations of members  
- Conversation transcripts / raw audio (Mobile T29 design already avoids transcript storage)  
- Auth tokens, OTP codes  

Sensitivity column + review checklist before publish.

## 8. Environment separation

| Environment | Admin URL / project | AI ops |
|-------------|---------------------|--------|
| Development | `lhzgfhbnfbztwnowxxoy` (documented) | Local Admin + Dev Edge secrets |
| Mobile AI Dev verify | `mnbwcwaxfywwkaxiwndo` | Connectivity Edge Dev-locked |
| Staging | Separate project ref (ops-defined) | Apply migrations only after approval |
| Production | `uecdmytikvwiosnyndxe` | Hard refuse reckless AI toggles; no Phase 1 changes |

Tool policies and import jobs must carry `environment` and default **disabled** in production.

## 9. Auditing

Use existing `admin_panel_audit_logs` plus optional `skg_ai_settings_changelog`.

Required action names (Mobile T29 contract):

- FAQ: `help.faq.create|update|publish|unpublish`  
- AI: `help_ai.settings.update`, `help_ai.emergency_disable`, `help_ai.emergency_enable`, `help_ai.voice_connectivity.verify`  

Phase 1: infrastructure ready; AI mutators not implemented yet.

## 10. Emergency stop architecture

1. `skg_ai_settings.emergency_disabled = true` + reason + actor.  
2. Call service-role RPC `emergency_terminate_skg_ai_sessions(reason)`.  
3. `get_skg_ai_quota()` already surfaces emergency to Mobile.  
4. Admin UI (future) requires `help_ai.manage` + confirmation + audit.  
5. Re-enable is a separate audited action; voice still needs connectivity stamp + `voice_enabled` rules.

Phase 1 does **not** expose emergency controls in UI.

## 11. Phase 1 residual risks

| Risk | Mitigation now |
|------|----------------|
| Permission keys in TS but DB seed not applied | Documented; Super Admin still works via bypass; other roles need migration apply on Staging |
| Placeholder tabs visible to authorized users only | `filteredNavGroups` |
| Accidental Gemini invocation | No Gemini client code in Admin Phase 1 |
