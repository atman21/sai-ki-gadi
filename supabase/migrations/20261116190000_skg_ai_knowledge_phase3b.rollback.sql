-- Rollback for 20261116190000_skg_ai_knowledge_phase3b.sql
-- Source only — do not apply to Production from this change set.

begin;

drop trigger if exists trg_skg_ai_knowledge_article_translations_updated
  on public.skg_ai_knowledge_article_translations;
drop trigger if exists trg_skg_ai_knowledge_articles_updated
  on public.skg_ai_knowledge_articles;
drop trigger if exists trg_skg_ai_knowledge_categories_updated
  on public.skg_ai_knowledge_categories;

drop table if exists public.skg_ai_knowledge_article_versions;
drop table if exists public.skg_ai_knowledge_article_translations;
drop table if exists public.skg_ai_knowledge_articles;
drop table if exists public.skg_ai_knowledge_categories;

commit;
