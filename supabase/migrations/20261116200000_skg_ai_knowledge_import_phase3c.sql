-- SKG AI Phase 3C — Knowledge Import jobs + private storage (SOURCE ONLY).
-- Staging project ref: mnbwcwaxfywwkaxiwndo
-- Do NOT apply to Production (uecdmytikvwiosnyndxe) from this change set.
-- Depends on Phase 3B knowledge tables (20261116190000_skg_ai_knowledge_phase3b.sql).
-- Imported content is untrusted. Never auto-publish. Not Gemini-accessible until Phase 3B publish.

begin;

-- ---------------------------------------------------------------------------
-- 1) Import jobs
-- ---------------------------------------------------------------------------
create table if not exists public.skg_ai_knowledge_import_jobs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'uploaded'
    check (status in (
      'uploaded',
      'processing',
      'extracted',
      'failed',
      'cancelled',
      'articles_created'
    )),
  original_filename text not null
    check (char_length(original_filename) between 1 and 260),
  safe_filename text not null
    check (char_length(safe_filename) between 1 and 260),
  format text not null
    check (format in ('pdf', 'docx', 'txt', 'md')),
  content_type text not null
    check (char_length(content_type) between 1 and 120),
  byte_size integer not null check (byte_size > 0 and byte_size <= 5242880),
  content_sha256 text not null
    check (char_length(content_sha256) = 64),
  storage_bucket text not null default 'skg-ai-knowledge-imports'
    check (storage_bucket = 'skg-ai-knowledge-imports'),
  storage_path text not null
    check (char_length(storage_path) between 1 and 500),
  extracted_text text
    check (extracted_text is null or char_length(extracted_text) <= 500000),
  extracted_char_count integer not null default 0
    check (extracted_char_count >= 0),
  edited_text text
    check (edited_text is null or char_length(edited_text) <= 500000),
  preview_text text
    check (preview_text is null or char_length(preview_text) <= 4000),
  category_id uuid
    references public.skg_ai_knowledge_categories (id) on delete set null,
  locale text
    check (locale is null or locale in ('en', 'hi', 'gu')),
  error_summary text
    check (error_summary is null or char_length(error_summary) <= 1000),
  parser_version text not null default 'phase3c-v1',
  created_article_ids uuid[] not null default '{}'::uuid[],
  uploaded_by uuid references public.admin_panel_users (id) on delete set null,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists skg_ai_knowledge_import_jobs_status_idx
  on public.skg_ai_knowledge_import_jobs (status, created_at desc);

create index if not exists skg_ai_knowledge_import_jobs_uploaded_by_idx
  on public.skg_ai_knowledge_import_jobs (uploaded_by, created_at desc);

create index if not exists skg_ai_knowledge_import_jobs_sha_idx
  on public.skg_ai_knowledge_import_jobs (content_sha256);

drop trigger if exists trg_skg_ai_knowledge_import_jobs_updated
  on public.skg_ai_knowledge_import_jobs;
create trigger trg_skg_ai_knowledge_import_jobs_updated
  before update on public.skg_ai_knowledge_import_jobs
  for each row execute function public.skg_ai_set_updated_at();

-- Optional provenance on articles (Phase 3B table must exist).
alter table public.skg_ai_knowledge_articles
  add column if not exists source_import_job_id uuid
    references public.skg_ai_knowledge_import_jobs (id) on delete set null;

alter table public.skg_ai_knowledge_articles
  add column if not exists source_filename text
    check (source_filename is null or char_length(source_filename) <= 260);

create index if not exists skg_ai_knowledge_articles_import_job_idx
  on public.skg_ai_knowledge_articles (source_import_job_id)
  where source_import_job_id is not null;

-- ---------------------------------------------------------------------------
-- 2) RLS — service_role only (private imports never Mobile JWT readable)
-- ---------------------------------------------------------------------------
alter table public.skg_ai_knowledge_import_jobs enable row level security;

revoke all on table public.skg_ai_knowledge_import_jobs
  from public, anon, authenticated;

grant select, insert, update, delete
  on table public.skg_ai_knowledge_import_jobs to service_role;

-- ---------------------------------------------------------------------------
-- 3) Private Storage bucket (no public read)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'skg-ai-knowledge-imports',
  'skg-ai-knowledge-imports',
  false,
  5242880,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'text/plain',
    'text/markdown',
    'application/octet-stream'
  ]::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Deny public/authenticated direct storage access; Admin uses service_role APIs.
drop policy if exists skg_ai_knowledge_imports_no_public on storage.objects;
-- No permissive policies for anon/authenticated — service_role bypasses RLS.

comment on table public.skg_ai_knowledge_import_jobs is
  'Phase 3C Knowledge Import jobs. Extracted text is untrusted. Articles created from imports must start as draft and use Phase 3B approve/publish before Gemini eligibility.';

-- Admin audit actions (contract):
--   help_ai.knowledge.import.upload
--   help_ai.knowledge.import.process
--   help_ai.knowledge.import.retry
--   help_ai.knowledge.import.review
--   help_ai.knowledge.import.create_articles
--   help_ai.knowledge.import.cancel
--   help_ai.knowledge.import.delete

commit;
