/**
 * Server-side helpers for Knowledge Base persistence (Phase 3B).
 * Uses Admin service-role client only.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  type AiKnowledgeStatus,
  type KnowledgeTranslationInput,
} from "@/lib/ai-knowledge-admin";

export const KNOWLEDGE_ARTICLE_SELECT = `
  id,
  category_id,
  status,
  sort_order,
  keywords,
  version,
  rejection_reason,
  approved_at,
  approved_by,
  published_at,
  published_by,
  archived_at,
  archived_by,
  created_at,
  created_by,
  updated_at,
  updated_by,
  skg_ai_knowledge_categories ( id, key, label, is_active, sort_order ),
  skg_ai_knowledge_article_translations ( id, locale, title, body, updated_at )
`;

export type TranslationRow = {
  id?: string;
  locale: string;
  title: string;
  body: string;
  updated_at?: string | null;
};

export type CategoryEmbed = {
  id: string;
  key: string;
  label: string;
  is_active: boolean;
  sort_order: number;
};

export function asCategory(value: unknown): CategoryEmbed | null {
  if (!value) return null;
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  return {
    id: String(r.id ?? ""),
    key: String(r.key ?? ""),
    label: String(r.label ?? r.key ?? ""),
    is_active: r.is_active !== false,
    sort_order: Number(r.sort_order ?? 0),
  };
}

export function asTranslations(value: unknown): TranslationRow[] {
  if (!value) return [];
  const rows = Array.isArray(value) ? value : [value];
  return rows
    .filter((row): row is TranslationRow => Boolean(row && typeof row === "object"))
    .map((row) => ({
      id: row.id ? String(row.id) : undefined,
      locale: String(row.locale ?? ""),
      title: String(row.title ?? ""),
      body: String(row.body ?? ""),
      updated_at: row.updated_at ? String(row.updated_at) : null,
    }));
}

export function mapArticleListItem(row: Record<string, unknown>) {
  const category = asCategory(row.skg_ai_knowledge_categories);
  const translations = asTranslations(
    row.skg_ai_knowledge_article_translations,
  );
  const locales = translations.map((t) => t.locale).filter(Boolean).sort();
  const primary =
    translations.find((t) => t.locale === "en") ?? translations[0] ?? null;

  return {
    id: String(row.id),
    category_id: String(row.category_id),
    category_key: category?.key ?? null,
    category_label: category?.label ?? null,
    status: String(row.status ?? "draft"),
    sort_order: Number(row.sort_order ?? 0),
    keywords: Array.isArray(row.keywords) ? (row.keywords as string[]) : [],
    version: Number(row.version ?? 1),
    rejection_reason: (row.rejection_reason as string | null) ?? null,
    approved_at: (row.approved_at as string | null) ?? null,
    published_at: (row.published_at as string | null) ?? null,
    archived_at: (row.archived_at as string | null) ?? null,
    created_at: (row.created_at as string | null) ?? null,
    updated_at: (row.updated_at as string | null) ?? null,
    locales,
    title_preview: primary?.title ?? "",
    body_preview: (primary?.body ?? "").slice(0, 160),
    gemini_eligible: String(row.status) === "published",
  };
}

export function mapArticleDetail(row: Record<string, unknown>) {
  const list = mapArticleListItem(row);
  const translations = asTranslations(
    row.skg_ai_knowledge_article_translations,
  );
  return {
    ...list,
    approved_by: (row.approved_by as string | null) ?? null,
    published_by: (row.published_by as string | null) ?? null,
    archived_by: (row.archived_by as string | null) ?? null,
    created_by: (row.created_by as string | null) ?? null,
    updated_by: (row.updated_by as string | null) ?? null,
    translations,
  };
}

export async function replaceTranslations(
  supabase: SupabaseClient,
  articleId: string,
  translations: KnowledgeTranslationInput[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error: delError } = await supabase
    .from("skg_ai_knowledge_article_translations")
    .delete()
    .eq("article_id", articleId);
  if (delError) {
    return { ok: false, error: delError.message };
  }
  if (translations.length === 0) return { ok: true };

  const { error: insError } = await supabase
    .from("skg_ai_knowledge_article_translations")
    .insert(
      translations.map((t) => ({
        article_id: articleId,
        locale: t.locale,
        title: t.title,
        body: t.body,
      })),
    );
  if (insError) {
    return { ok: false, error: insError.message };
  }
  return { ok: true };
}

export async function appendKnowledgeVersion(
  supabase: SupabaseClient,
  args: {
    articleId: string;
    version: number;
    status: AiKnowledgeStatus | string;
    changeReason: string;
    changedBy: string | null;
    categoryId: string;
    sortOrder: number;
    keywords: string[];
    rejectionReason?: string | null;
    translations: Array<{ locale: string; title: string; body: string }>;
  },
): Promise<void> {
  await supabase.from("skg_ai_knowledge_article_versions").insert({
    article_id: args.articleId,
    version: args.version,
    status: args.status,
    change_reason: args.changeReason.slice(0, 500),
    changed_by: args.changedBy,
    category_id: args.categoryId,
    sort_order: args.sortOrder,
    keywords: args.keywords,
    rejection_reason: args.rejectionReason ?? null,
    translations_json: args.translations.map((t) => ({
      locale: t.locale,
      title: t.title,
      body: t.body,
      title_length: t.title.length,
      body_length: t.body.length,
    })),
  });
}
