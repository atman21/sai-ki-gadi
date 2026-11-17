-- SKG AI Phase 3B — Knowledge Base (Admin-owned migration SOURCE ONLY).
-- Staging project ref: mnbwcwaxfywwkaxiwndo
-- Do NOT apply to Production (uecdmytikvwiosnyndxe) from this change set.
-- Do NOT apply automatically from Admin Web CI in this phase.
--
-- Distinct from Help FAQ (help_faq_*). Curated AI knowledge with approval workflow.
-- Gemini Live does NOT retrieve these rows yet — published content isolation only.

begin;

-- ---------------------------------------------------------------------------
-- 1) Categories (keys + labels only — no article/policy seed content)
-- ---------------------------------------------------------------------------
create table if not exists public.skg_ai_knowledge_categories (
  id uuid primary key default gen_random_uuid(),
  key text not null unique
    check (char_length(key) between 2 and 64),
  label text not null
    check (char_length(label) between 1 and 120),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_skg_ai_knowledge_categories_updated
  on public.skg_ai_knowledge_categories;
create trigger trg_skg_ai_knowledge_categories_updated
  before update on public.skg_ai_knowledge_categories
  for each row execute function public.skg_ai_set_updated_at();

insert into public.skg_ai_knowledge_categories (key, label, sort_order) values
  ('membership', 'Membership', 10),
  ('trip_points', 'Trip Points', 20),
  ('bookings', 'Bookings', 30),
  ('payments', 'Payments', 40),
  ('lucky_draw', 'Lucky Draw', 50),
  ('driver_services', 'Driver Services', 60),
  ('exchange', 'Exchange', 70),
  ('help_center', 'Help Center', 80),
  ('profile', 'Profile', 90),
  ('otp_login', 'OTP / Login', 100),
  ('general_app', 'General SKG App Information', 110)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2) Articles
-- ---------------------------------------------------------------------------
create table if not exists public.skg_ai_knowledge_articles (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null
    references public.skg_ai_knowledge_categories (id) on delete restrict,
  status text not null default 'draft'
    check (status in (
      'draft',
      'pending_review',
      'approved',
      'published',
      'rejected',
      'archived'
    )),
  sort_order integer not null default 0,
  keywords text[] not null default '{}'::text[],
  version integer not null default 1 check (version >= 1),
  rejection_reason text
    check (
      rejection_reason is null
      or char_length(rejection_reason) between 1 and 1000
    ),
  approved_at timestamptz,
  approved_by uuid references public.admin_panel_users (id) on delete set null,
  published_at timestamptz,
  published_by uuid references public.admin_panel_users (id) on delete set null,
  archived_at timestamptz,
  archived_by uuid references public.admin_panel_users (id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid references public.admin_panel_users (id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.admin_panel_users (id) on delete set null,
  constraint skg_ai_knowledge_articles_published_meta check (
    (status <> 'published')
    or (published_at is not null and approved_at is not null)
  )
);

create index if not exists skg_ai_knowledge_articles_status_idx
  on public.skg_ai_knowledge_articles (status, updated_at desc);

create index if not exists skg_ai_knowledge_articles_category_idx
  on public.skg_ai_knowledge_articles (category_id, status);

create index if not exists skg_ai_knowledge_articles_published_idx
  on public.skg_ai_knowledge_articles (published_at desc)
  where status = 'published';

drop trigger if exists trg_skg_ai_knowledge_articles_updated
  on public.skg_ai_knowledge_articles;
create trigger trg_skg_ai_knowledge_articles_updated
  before update on public.skg_ai_knowledge_articles
  for each row execute function public.skg_ai_set_updated_at();

-- ---------------------------------------------------------------------------
-- 3) Translations (en / hi / gu)
-- ---------------------------------------------------------------------------
create table if not exists public.skg_ai_knowledge_article_translations (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null
    references public.skg_ai_knowledge_articles (id) on delete cascade,
  locale text not null check (locale in ('en', 'hi', 'gu')),
  title text not null
    check (char_length(title) between 1 and 300),
  body text not null
    check (char_length(body) between 1 and 20000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (article_id, locale)
);

create index if not exists skg_ai_knowledge_article_translations_article_idx
  on public.skg_ai_knowledge_article_translations (article_id);

drop trigger if exists trg_skg_ai_knowledge_article_translations_updated
  on public.skg_ai_knowledge_article_translations;
create trigger trg_skg_ai_knowledge_article_translations_updated
  before update on public.skg_ai_knowledge_article_translations
  for each row execute function public.skg_ai_set_updated_at();

-- ---------------------------------------------------------------------------
-- 4) Append-only version history
-- ---------------------------------------------------------------------------
create table if not exists public.skg_ai_knowledge_article_versions (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null
    references public.skg_ai_knowledge_articles (id) on delete cascade,
  version integer not null check (version >= 1),
  status text not null
    check (status in (
      'draft',
      'pending_review',
      'approved',
      'published',
      'rejected',
      'archived'
    )),
  change_reason text not null default 'update'
    check (char_length(change_reason) between 1 and 500),
  changed_by uuid references public.admin_panel_users (id) on delete set null,
  created_at timestamptz not null default now(),
  category_id uuid,
  sort_order integer,
  keywords text[] not null default '{}'::text[],
  rejection_reason text,
  -- Frozen translations snapshot (no secrets).
  translations_json jsonb not null default '[]'::jsonb,
  unique (article_id, version, change_reason, created_at)
);

create index if not exists skg_ai_knowledge_article_versions_article_idx
  on public.skg_ai_knowledge_article_versions (article_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 5) RLS — service_role only (draft/unpublished must never reach Mobile JWT)
-- ---------------------------------------------------------------------------
alter table public.skg_ai_knowledge_categories enable row level security;
alter table public.skg_ai_knowledge_articles enable row level security;
alter table public.skg_ai_knowledge_article_translations enable row level security;
alter table public.skg_ai_knowledge_article_versions enable row level security;

revoke all on table public.skg_ai_knowledge_categories from public, anon, authenticated;
revoke all on table public.skg_ai_knowledge_articles from public, anon, authenticated;
revoke all on table public.skg_ai_knowledge_article_translations from public, anon, authenticated;
revoke all on table public.skg_ai_knowledge_article_versions from public, anon, authenticated;

grant select, insert, update, delete on table public.skg_ai_knowledge_categories to service_role;
grant select, insert, update, delete on table public.skg_ai_knowledge_articles to service_role;
grant select, insert, update, delete on table public.skg_ai_knowledge_article_translations to service_role;
grant select, insert, update, delete on table public.skg_ai_knowledge_article_versions to service_role;

-- No policies for authenticated/anon — deny-by-default under RLS.
-- Future Gemini retrieval must use service_role and status = 'published' only.

comment on table public.skg_ai_knowledge_articles is
  'SKG AI Knowledge Base articles. Phase 3B Admin CRUD. Not injected into Gemini Live yet. Only status=published is eligible for future retrieval.';

comment on table public.skg_ai_knowledge_article_translations is
  'Localized title/body for knowledge articles (en/hi/gu). Unpublished content must not be exposed to Mobile or Gemini.';

-- ---------------------------------------------------------------------------
-- 6) Admin audit action contract (documentation in comments)
-- ---------------------------------------------------------------------------
-- Admin APIs (service_role) MUST write admin_panel_audit_logs for:
--   help_ai.knowledge.create
--   help_ai.knowledge.update
--   help_ai.knowledge.submit_review
--   help_ai.knowledge.approve
--   help_ai.knowledge.reject
--   help_ai.knowledge.publish
--   help_ai.knowledge.unpublish
--   help_ai.knowledge.archive
--   help_ai.knowledge.category.update
-- using existing writeAdminAudit / admin_panel_audit_logs.

commit;
