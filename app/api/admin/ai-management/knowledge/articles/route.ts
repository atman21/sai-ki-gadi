import { NextResponse } from "next/server";

import {
  requireAdminPermission,
  safeErrorMessage,
} from "@/lib/admin-api";
import {
  clientMetaFromRequest,
  recordChange,
  recordFailure,
} from "@/lib/admin-audit";
import { isAdminUuid } from "@/lib/admin-uuid";
import {
  GEMINI_KNOWLEDGE_RETRIEVAL,
  isAiKnowledgeStatus,
  knowledgeAuditSnapshot,
  parseKnowledgeKeywords,
  parseKnowledgeTranslations,
} from "@/lib/ai-knowledge-admin";
import {
  KNOWLEDGE_ARTICLE_SELECT,
  appendKnowledgeVersion,
  mapArticleListItem,
  replaceTranslations,
} from "@/lib/ai-knowledge-store";

/**
 * GET — list knowledge articles (help_ai.view)
 * Query: q, status, locale, category_id, page, page_size
 */
export async function GET(request: Request) {
  const gate = await requireAdminPermission("help_ai.view", {
    request,
    auditModule: "help_ai",
  });
  if (!gate.ok) return gate.response;

  try {
    const { searchParams } = new URL(request.url);
    const q = (searchParams.get("q") ?? "").trim().slice(0, 120);
    const statusRaw = searchParams.get("status");
    const localeRaw = searchParams.get("locale");
    const categoryId = searchParams.get("category_id");
    const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, Number(searchParams.get("page_size") ?? "25") || 25),
    );

    if (statusRaw && !isAiKnowledgeStatus(statusRaw)) {
      return NextResponse.json(
        { ok: false, error: "Invalid status filter." },
        { status: 400 },
      );
    }
    if (categoryId && !isAdminUuid(categoryId)) {
      return NextResponse.json(
        { ok: false, error: "Invalid category_id." },
        { status: 400 },
      );
    }

    let query = gate.supabase
      .from("skg_ai_knowledge_articles")
      .select(KNOWLEDGE_ARTICLE_SELECT, { count: "exact" })
      .order("updated_at", { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);

    if (statusRaw) query = query.eq("status", statusRaw);
    if (categoryId) query = query.eq("category_id", categoryId);

    const { data, error, count } = await query;
    if (error) {
      return NextResponse.json(
        {
          ok: false,
          error: safeErrorMessage(error, "Failed to load articles."),
          migration_required: true,
        },
        { status: 500 },
      );
    }

    let items = (data ?? []).map((row) =>
      mapArticleListItem(row as Record<string, unknown>),
    );

    if (localeRaw) {
      items = items.filter((item) => item.locales.includes(localeRaw));
    }
    if (q) {
      const needle = q.toLowerCase();
      items = items.filter(
        (item) =>
          item.title_preview.toLowerCase().includes(needle) ||
          item.body_preview.toLowerCase().includes(needle) ||
          item.keywords.some((k) => k.includes(needle)) ||
          (item.category_label ?? "").toLowerCase().includes(needle),
      );
    }

    return NextResponse.json({
      ok: true,
      items,
      total: typeof count === "number" ? count : items.length,
      page,
      page_size: pageSize,
      gemini_retrieval: GEMINI_KNOWLEDGE_RETRIEVAL,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: safeErrorMessage(error, "Failed to load articles."),
      },
      { status: 500 },
    );
  }
}

/**
 * POST — create draft article (help_ai.manage)
 */
export async function POST(request: Request) {
  const gate = await requireAdminPermission("help_ai.manage", {
    request,
    auditModule: "help_ai",
  });
  if (!gate.ok) return gate.response;

  const auditBase = {
    actor: gate.actor,
    module: "help_ai",
    resourceType: "skg_ai_knowledge_article",
    ...clientMetaFromRequest(request),
  };

  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json(
        { ok: false, error: "Body must be an object." },
        { status: 400 },
      );
    }

    const categoryId = String((body as { category_id?: unknown }).category_id ?? "");
    if (!isAdminUuid(categoryId)) {
      return NextResponse.json(
        { ok: false, error: "Valid category_id is required." },
        { status: 400 },
      );
    }

    const sortOrder = Number((body as { sort_order?: unknown }).sort_order ?? 0);
    if (!Number.isInteger(sortOrder)) {
      return NextResponse.json(
        { ok: false, error: "sort_order must be an integer." },
        { status: 400 },
      );
    }

    const keywordsParsed = parseKnowledgeKeywords(
      (body as { keywords?: unknown }).keywords,
    );
    if (!keywordsParsed.ok) {
      return NextResponse.json(
        { ok: false, error: keywordsParsed.error },
        { status: 400 },
      );
    }

    const translationsParsed = parseKnowledgeTranslations(
      (body as { translations?: unknown }).translations,
    );
    if (!translationsParsed.ok) {
      return NextResponse.json(
        { ok: false, error: translationsParsed.error },
        { status: 400 },
      );
    }

    const { data: category, error: catError } = await gate.supabase
      .from("skg_ai_knowledge_categories")
      .select("id, is_active")
      .eq("id", categoryId)
      .maybeSingle();
    if (catError || !category) {
      return NextResponse.json(
        { ok: false, error: "Category not found." },
        { status: 400 },
      );
    }

    const { data: created, error: createError } = await gate.supabase
      .from("skg_ai_knowledge_articles")
      .insert({
        category_id: categoryId,
        status: "draft",
        sort_order: sortOrder,
        keywords: keywordsParsed.keywords,
        version: 1,
        created_by: gate.actor.id,
        updated_by: gate.actor.id,
      })
      .select("id")
      .maybeSingle();

    if (createError || !created) {
      void recordFailure({
        ...auditBase,
        action: "help_ai.knowledge.create",
        description: "Failed to create knowledge article",
        reason: createError?.message ?? "create_failed",
      });
      return NextResponse.json(
        {
          ok: false,
          error: safeErrorMessage(
            createError,
            "Failed to create knowledge article.",
          ),
        },
        { status: 500 },
      );
    }

    const articleId = String(created.id);
    const replaced = await replaceTranslations(
      gate.supabase,
      articleId,
      translationsParsed.translations,
    );
    if (!replaced.ok) {
      await gate.supabase
        .from("skg_ai_knowledge_articles")
        .delete()
        .eq("id", articleId);
      return NextResponse.json(
        { ok: false, error: replaced.error },
        { status: 500 },
      );
    }

    await appendKnowledgeVersion(gate.supabase, {
      articleId,
      version: 1,
      status: "draft",
      changeReason: "create",
      changedBy: gate.actor.id,
      categoryId,
      sortOrder,
      keywords: keywordsParsed.keywords,
      translations: translationsParsed.translations,
    });

    const { data: full } = await gate.supabase
      .from("skg_ai_knowledge_articles")
      .select(KNOWLEDGE_ARTICLE_SELECT)
      .eq("id", articleId)
      .maybeSingle();

    const item = full
      ? mapArticleListItem(full as Record<string, unknown>)
      : { id: articleId, status: "draft" };

    void recordChange({
      ...auditBase,
      resourceId: articleId,
      action: "help_ai.knowledge.create",
      description: `Created knowledge article draft ${articleId}`,
      changedFields: ["status", "category_id", "translations"],
      afterData: knowledgeAuditSnapshot({
        id: articleId,
        category_id: categoryId,
        status: "draft",
        version: 1,
        locales: translationsParsed.translations.map((t) => t.locale),
        title_preview: translationsParsed.translations[0]?.title ?? null,
      }),
    });

    return NextResponse.json({ ok: true, item }, { status: 201 });
  } catch (error) {
    void recordFailure({
      ...auditBase,
      action: "help_ai.knowledge.create",
      description: "Failed to create knowledge article",
      reason: safeErrorMessage(error, "create_failed"),
    });
    return NextResponse.json(
      {
        ok: false,
        error: safeErrorMessage(error, "Failed to create knowledge article."),
      },
      { status: 500 },
    );
  }
}
