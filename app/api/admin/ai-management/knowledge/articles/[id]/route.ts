import { NextResponse } from "next/server";

import {
  requireAdminPermission,
  safeErrorMessage,
} from "@/lib/admin-api";
import {
  clientMetaFromRequest,
  diffChangedFields,
  recordChange,
  recordFailure,
} from "@/lib/admin-audit";
import { isAdminUuid } from "@/lib/admin-uuid";
import {
  GEMINI_KNOWLEDGE_RETRIEVAL,
  canEditKnowledgeContent,
  isAiKnowledgeStatus,
  knowledgeAuditSnapshot,
  parseKnowledgeKeywords,
  parseKnowledgeTranslations,
} from "@/lib/ai-knowledge-admin";
import {
  KNOWLEDGE_ARTICLE_SELECT,
  appendKnowledgeVersion,
  asTranslations,
  mapArticleDetail,
  replaceTranslations,
} from "@/lib/ai-knowledge-store";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET — article detail (help_ai.view)
 */
export async function GET(request: Request, context: Ctx) {
  const gate = await requireAdminPermission("help_ai.view", {
    request,
    auditModule: "help_ai",
  });
  if (!gate.ok) return gate.response;

  const { id } = await context.params;
  if (!isAdminUuid(id)) {
    return NextResponse.json({ ok: false, error: "Invalid article id." }, { status: 400 });
  }

  try {
    const { data, error } = await gate.supabase
      .from("skg_ai_knowledge_articles")
      .select(KNOWLEDGE_ARTICLE_SELECT)
      .eq("id", id)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          error: safeErrorMessage(error, "Failed to load article."),
        },
        { status: 500 },
      );
    }
    if (!data) {
      return NextResponse.json(
        { ok: false, error: "Article not found." },
        { status: 404 },
      );
    }

    return NextResponse.json({
      ok: true,
      item: mapArticleDetail(data as Record<string, unknown>),
      gemini_retrieval: GEMINI_KNOWLEDGE_RETRIEVAL,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: safeErrorMessage(error, "Failed to load article."),
      },
      { status: 500 },
    );
  }
}

/**
 * PUT — update draft/rejected article content (help_ai.manage)
 * Does not publish. Does not change status except rejected → draft on edit.
 */
export async function PUT(request: Request, context: Ctx) {
  const gate = await requireAdminPermission("help_ai.manage", {
    request,
    auditModule: "help_ai",
  });
  if (!gate.ok) return gate.response;

  const { id } = await context.params;
  if (!isAdminUuid(id)) {
    return NextResponse.json({ ok: false, error: "Invalid article id." }, { status: 400 });
  }

  const auditBase = {
    actor: gate.actor,
    module: "help_ai",
    resourceType: "skg_ai_knowledge_article",
    resourceId: id,
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

    const { data: existing, error: loadError } = await gate.supabase
      .from("skg_ai_knowledge_articles")
      .select(KNOWLEDGE_ARTICLE_SELECT)
      .eq("id", id)
      .maybeSingle();

    if (loadError) {
      return NextResponse.json(
        {
          ok: false,
          error: safeErrorMessage(loadError, "Failed to load article."),
        },
        { status: 500 },
      );
    }
    if (!existing) {
      return NextResponse.json(
        { ok: false, error: "Article not found." },
        { status: 404 },
      );
    }

    const currentStatus = String(existing.status ?? "draft");
    if (!isAiKnowledgeStatus(currentStatus) || !canEditKnowledgeContent(currentStatus)) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Only draft or rejected articles can be edited. Unpublish or use workflow actions for other states.",
        },
        { status: 400 },
      );
    }

    const categoryId = String(
      (body as { category_id?: unknown }).category_id ?? existing.category_id,
    );
    if (!isAdminUuid(categoryId)) {
      return NextResponse.json(
        { ok: false, error: "Valid category_id is required." },
        { status: 400 },
      );
    }

    const sortOrder = Number(
      (body as { sort_order?: unknown }).sort_order ?? existing.sort_order ?? 0,
    );
    if (!Number.isInteger(sortOrder)) {
      return NextResponse.json(
        { ok: false, error: "sort_order must be an integer." },
        { status: 400 },
      );
    }

    const keywordsParsed = parseKnowledgeKeywords(
      (body as { keywords?: unknown }).keywords ?? existing.keywords,
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

    const nextVersion = Number(existing.version ?? 1) + 1;
    const nextStatus = currentStatus === "rejected" ? "draft" : currentStatus;

    const { error: updateError } = await gate.supabase
      .from("skg_ai_knowledge_articles")
      .update({
        category_id: categoryId,
        sort_order: sortOrder,
        keywords: keywordsParsed.keywords,
        version: nextVersion,
        status: nextStatus,
        rejection_reason: nextStatus === "draft" ? null : existing.rejection_reason,
        updated_by: gate.actor.id,
      })
      .eq("id", id);

    if (updateError) {
      void recordFailure({
        ...auditBase,
        action: "help_ai.knowledge.update",
        description: `Failed to update knowledge article ${id}`,
        reason: updateError.message,
      });
      return NextResponse.json(
        {
          ok: false,
          error: safeErrorMessage(updateError, "Failed to update article."),
        },
        { status: 500 },
      );
    }

    if ((body as { translations?: unknown }).translations !== undefined) {
      const replaced = await replaceTranslations(
        gate.supabase,
        id,
        translationsParsed.translations,
      );
      if (!replaced.ok) {
        return NextResponse.json(
          { ok: false, error: replaced.error },
          { status: 500 },
        );
      }
    }

    const translations =
      (body as { translations?: unknown }).translations !== undefined
        ? translationsParsed.translations
        : asTranslations(
            (existing as { skg_ai_knowledge_article_translations?: unknown })
              .skg_ai_knowledge_article_translations,
          ).map((t) => ({
            locale: t.locale as "en" | "hi" | "gu",
            title: t.title,
            body: t.body,
          }));

    await appendKnowledgeVersion(gate.supabase, {
      articleId: id,
      version: nextVersion,
      status: nextStatus,
      changeReason: "update",
      changedBy: gate.actor.id,
      categoryId,
      sortOrder,
      keywords: keywordsParsed.keywords,
      translations,
    });

    const { data: full } = await gate.supabase
      .from("skg_ai_knowledge_articles")
      .select(KNOWLEDGE_ARTICLE_SELECT)
      .eq("id", id)
      .maybeSingle();

    const before = mapArticleDetail(existing as Record<string, unknown>);
    const after = full
      ? mapArticleDetail(full as Record<string, unknown>)
      : before;

    void recordChange({
      ...auditBase,
      action: "help_ai.knowledge.update",
      description: `Updated knowledge article ${id}`,
      changedFields: diffChangedFields(
        knowledgeAuditSnapshot(before),
        knowledgeAuditSnapshot(after),
      ),
      beforeData: knowledgeAuditSnapshot(before),
      afterData: knowledgeAuditSnapshot(after),
    });

    return NextResponse.json({ ok: true, item: after });
  } catch (error) {
    void recordFailure({
      ...auditBase,
      action: "help_ai.knowledge.update",
      description: `Failed to update knowledge article ${id}`,
      reason: safeErrorMessage(error, "update_failed"),
    });
    return NextResponse.json(
      {
        ok: false,
        error: safeErrorMessage(error, "Failed to update article."),
      },
      { status: 500 },
    );
  }
}
