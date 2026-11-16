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
  isAiKnowledgeLocale,
  knowledgeAuditSnapshot,
  type AiKnowledgeLocale,
} from "@/lib/ai-knowledge-admin";
import {
  appendKnowledgeVersion,
  replaceTranslations,
} from "@/lib/ai-knowledge-store";
import {
  canCreateArticlesFromImport,
  importJobAuditSnapshot,
  isAiKnowledgeImportStatus,
  normalizeExtractedText,
  splitImportSegments,
  wrapUntrustedImportBody,
} from "@/lib/ai-knowledge-import";

type Ctx = { params: Promise<{ id: string }> };

type SegmentInput = { title?: unknown; body?: unknown };

/**
 * POST — create Knowledge Base draft article(s) from reviewed import text.
 * Never publishes. Requires help_ai.manage.
 *
 * Body (optional):
 * {
 *   split?: boolean,           // default true — split by --- / headings
 *   segments?: [{ title, body }],
 *   category_id?: uuid,
 *   locale?: en|hi|gu
 * }
 */
export async function POST(request: Request, context: Ctx) {
  const gate = await requireAdminPermission("help_ai.manage", {
    request,
    auditModule: "help_ai",
  });
  if (!gate.ok) return gate.response;

  const { id } = await context.params;
  if (!isAdminUuid(id)) {
    return NextResponse.json({ ok: false, error: "Invalid job id." }, { status: 400 });
  }

  const auditBase = {
    actor: gate.actor,
    module: "help_ai",
    resourceType: "skg_ai_knowledge_import_job",
    resourceId: id,
    ...clientMetaFromRequest(request),
  };

  try {
    const body = await request.json().catch(() => ({}));
    const payload =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : {};

    const { data: job, error: loadError } = await gate.supabase
      .from("skg_ai_knowledge_import_jobs")
      .select(
        `id, status, edited_text, extracted_text, category_id, locale,
         original_filename, created_article_ids`,
      )
      .eq("id", id)
      .maybeSingle();

    if (loadError || !job) {
      return NextResponse.json(
        {
          ok: false,
          error: loadError
            ? safeErrorMessage(loadError, "Failed to load import job.")
            : "Import job not found.",
        },
        { status: loadError ? 500 : 404 },
      );
    }

    const status = String(job.status);
    if (
      !isAiKnowledgeImportStatus(status) ||
      !canCreateArticlesFromImport(status)
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: "Articles can only be created from extracted imports.",
        },
        { status: 400 },
      );
    }

    const categoryId = String(
      payload.category_id ?? job.category_id ?? "",
    );
    if (!isAdminUuid(categoryId)) {
      return NextResponse.json(
        {
          ok: false,
          error: "category_id is required (assign a Knowledge Base category).",
        },
        { status: 400 },
      );
    }

    const localeRaw = payload.locale ?? job.locale ?? "en";
    if (!isAiKnowledgeLocale(localeRaw)) {
      return NextResponse.json(
        { ok: false, error: "locale must be en, hi, or gu." },
        { status: 400 },
      );
    }
    const locale = localeRaw as AiKnowledgeLocale;

    const sourceFilename = String(job.original_filename ?? "import");
    let segments: Array<{ title: string; body: string }> = [];

    if (Array.isArray(payload.segments) && payload.segments.length > 0) {
      for (const row of payload.segments as SegmentInput[]) {
        const title = normalizeExtractedText(String(row.title ?? "")).slice(
          0,
          300,
        );
        const body = normalizeExtractedText(String(row.body ?? ""));
        if (!title || !body) {
          return NextResponse.json(
            { ok: false, error: "Each segment needs a non-empty title and body." },
            { status: 400 },
          );
        }
        segments.push({
          title,
          body: wrapUntrustedImportBody(body, sourceFilename).slice(0, 20000),
        });
      }
    } else {
      const text = normalizeExtractedText(
        String(job.edited_text ?? job.extracted_text ?? ""),
      );
      if (!text) {
        return NextResponse.json(
          { ok: false, error: "No reviewed text available to import." },
          { status: 400 },
        );
      }
      const split = payload.split === false ? false : true;
      const rawSegments = split
        ? splitImportSegments(text)
        : [
            {
              title:
                text.split("\n")[0]?.replace(/^#+\s*/, "").slice(0, 300) ||
                sourceFilename,
              body: text,
            },
          ];
      segments = rawSegments.map((seg) => ({
        title: seg.title.slice(0, 300),
        body: wrapUntrustedImportBody(seg.body, sourceFilename).slice(0, 20000),
      }));
    }

    if (segments.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No article segments to create." },
        { status: 400 },
      );
    }
    if (segments.length > 40) {
      return NextResponse.json(
        { ok: false, error: "Too many segments (max 40 per import)." },
        { status: 400 },
      );
    }

    // Duplicate title warnings (soft)
    const duplicate_warnings: string[] = [];
    for (const seg of segments) {
      const { data: dupes } = await gate.supabase
        .from("skg_ai_knowledge_article_translations")
        .select("article_id, title")
        .eq("locale", locale)
        .ilike("title", seg.title.slice(0, 80))
        .limit(3);
      if (dupes && dupes.length > 0) {
        duplicate_warnings.push(
          `Possible duplicate title: "${seg.title.slice(0, 80)}"`,
        );
      }
    }

    const createdIds: string[] = Array.isArray(job.created_article_ids)
      ? [...(job.created_article_ids as string[])]
      : [];
    const createdItems: Array<Record<string, unknown>> = [];

    for (const seg of segments) {
      const { data: created, error: createError } = await gate.supabase
        .from("skg_ai_knowledge_articles")
        .insert({
          category_id: categoryId,
          status: "draft",
          sort_order: 0,
          keywords: ["imported"],
          version: 1,
          created_by: gate.actor.id,
          updated_by: gate.actor.id,
          source_import_job_id: id,
          source_filename: sourceFilename.slice(0, 260),
        })
        .select("id")
        .maybeSingle();

      if (createError || !created) {
        void recordFailure({
          ...auditBase,
          action: "help_ai.knowledge.import.create_articles",
          description: `Failed creating draft from import ${id}`,
          reason: createError?.message ?? "create_failed",
        });
        return NextResponse.json(
          {
            ok: false,
            error: safeErrorMessage(
              createError,
              "Failed to create draft article.",
            ),
            created_ids: createdIds,
            duplicate_warnings,
          },
          { status: 500 },
        );
      }

      const articleId = String(created.id);
      const replaced = await replaceTranslations(gate.supabase, articleId, [
        { locale, title: seg.title, body: seg.body },
      ]);
      if (!replaced.ok) {
        await gate.supabase
          .from("skg_ai_knowledge_articles")
          .delete()
          .eq("id", articleId);
        return NextResponse.json(
          { ok: false, error: replaced.error, created_ids: createdIds },
          { status: 500 },
        );
      }

      await appendKnowledgeVersion(gate.supabase, {
        articleId,
        version: 1,
        status: "draft",
        changeReason: "import_create",
        changedBy: gate.actor.id,
        categoryId,
        sortOrder: 0,
        keywords: ["imported"],
        translations: [{ locale, title: seg.title, body: seg.body }],
      });

      createdIds.push(articleId);
      createdItems.push(
        knowledgeAuditSnapshot({
          id: articleId,
          category_id: categoryId,
          status: "draft",
          version: 1,
          locales: [locale],
          title_preview: seg.title,
        }),
      );

      void recordChange({
        actor: gate.actor,
        module: "help_ai",
        resourceType: "skg_ai_knowledge_article",
        resourceId: articleId,
        action: "help_ai.knowledge.create",
        description: `Created draft knowledge article from import ${id}`,
        changedFields: ["status", "source_import_job_id"],
        afterData: knowledgeAuditSnapshot({
          id: articleId,
          category_id: categoryId,
          status: "draft",
          locales: [locale],
          title_preview: seg.title,
        }),
        ...clientMetaFromRequest(request),
      });
    }

    const { data: updatedJob } = await gate.supabase
      .from("skg_ai_knowledge_import_jobs")
      .update({
        status: "articles_created",
        category_id: categoryId,
        locale,
        created_article_ids: createdIds,
      })
      .eq("id", id)
      .select(
        "id, status, created_article_ids, category_id, locale, original_filename",
      )
      .maybeSingle();

    void recordChange({
      ...auditBase,
      action: "help_ai.knowledge.import.create_articles",
      description: `Created ${segments.length} draft article(s) from import ${id}`,
      changedFields: ["status", "created_article_ids"],
      beforeData: importJobAuditSnapshot(job as Record<string, unknown>),
      afterData: {
        ...importJobAuditSnapshot(updatedJob as Record<string, unknown>),
        articles: createdItems,
      },
    });

    return NextResponse.json({
      ok: true,
      created_count: segments.length,
      created_ids: createdIds,
      articles: createdItems,
      duplicate_warnings,
      job: updatedJob,
      note: "Articles were created as draft only. Approve and publish via Knowledge Base workflow before Gemini eligibility.",
      gemini_eligible: false,
      auto_published: false,
    });
  } catch (error) {
    void recordFailure({
      ...auditBase,
      action: "help_ai.knowledge.import.create_articles",
      description: `Create articles failed for import ${id}`,
      reason: safeErrorMessage(error, "create_articles_failed"),
    });
    return NextResponse.json(
      {
        ok: false,
        error: safeErrorMessage(error, "Failed to create articles."),
      },
      { status: 500 },
    );
  }
}
