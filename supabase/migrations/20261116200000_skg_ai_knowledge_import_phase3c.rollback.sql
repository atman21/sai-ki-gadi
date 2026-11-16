-- Rollback for 20261116200000_skg_ai_knowledge_import_phase3c.sql
-- Source only — do not apply to Production from this change set.

begin;

drop index if exists public.skg_ai_knowledge_articles_import_job_idx;

alter table if exists public.skg_ai_knowledge_articles
  drop column if exists source_filename;

alter table if exists public.skg_ai_knowledge_articles
  drop column if exists source_import_job_id;

drop trigger if exists trg_skg_ai_knowledge_import_jobs_updated
  on public.skg_ai_knowledge_import_jobs;

drop table if exists public.skg_ai_knowledge_import_jobs;

delete from storage.objects where bucket_id = 'skg-ai-knowledge-imports';
delete from storage.buckets where id = 'skg-ai-knowledge-imports';

commit;
