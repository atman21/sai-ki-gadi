# AI Knowledge Base ↔ Gemini Retrieval Contract

**Phase:** 3B (Admin Web)  
**Status:** Admin Knowledge Base module complete · **Gemini retrieval: NOT wired**

## What Phase 3B ships

- Admin CRUD for curated knowledge articles (distinct from Help FAQ).
- Categories, en/hi/gu translations, approval workflow, versions, audit.
- Migration source: `supabase/migrations/20261116190000_skg_ai_knowledge_phase3b.sql`
  (and rollback). **Not applied** by this change set.
- RLS: **service_role only** — Mobile JWT cannot read draft or published rows today.

## Isolation rules (must hold)

| Content | Mobile JWT | Gemini Live mint today | Future retrieval |
|---------|------------|------------------------|------------------|
| draft / pending_review / rejected / archived | No | No | No |
| approved (not published) | No | No | No |
| **published** | No (until dedicated path) | **No** (Phase 3B) | Yes — only these |

Mint (`mint-skg-ai-live-token`) currently injects **published AI Instructions** only
(`skg_ai_instructions` / `global-published`). It does **not** query knowledge tables.

## Future retrieval design (document only — do not implement in 3B)

1. Apply knowledge migration on Staging after review.
2. Add Edge/service-role loader that selects:

```sql
select a.id, a.category_id, t.locale, t.title, t.body
from skg_ai_knowledge_articles a
join skg_ai_knowledge_article_translations t on t.article_id = a.id
where a.status = 'published'
  and t.locale = :session_locale  -- fallback en
order by a.sort_order, a.published_at desc
limit :budget;
```

3. Inject retrieved snippets into Live context under a strict token budget
   (separate from `systemInstruction` lock), **or** extend a dedicated
   tool/`grounding` path — product decision for a later phase.
4. Never send draft/rejected bodies. Never invent membership prices or policies.
5. Coordinate Edge + Mobile deploy; do not change Production from Admin Web alone.

## Clear split

| Layer | Phase 3B |
|-------|----------|
| Admin UI / APIs / RBAC / audit / versions | **Done** |
| Schema migration source | **Done (not applied)** |
| Gemini Live knowledge retrieval | **Not done** |
| Mobile V2 changes | **None** |
