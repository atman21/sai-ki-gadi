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
import { isAiKnowledgeLocale } from "@/lib/ai-knowledge-admin";
import {
  AI_KNOWLEDGE_IMPORT_MAX_TEXT_CHARS,
  buildPreviewText,
  canCreateArticlesFromImport,
  importJobAuditSnapshot,
  isAiKnowledgeImportStatus,
  normalizeExtractedText,
} from "@/lib/ai-knowledge-import";

type Ctx = { params: Promise<{ id: string }> };

/**
 * PUT — save reviewed/edited text + category + locale (help_ai.manage)
 */
export async function PUT(request: Request, context: Ctx) {
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
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json(
        { ok: false, error: "Body must be an object." },
        { status: 400 },
      );
    }

    const { data: existing, error: loadError } = await gate.supabase
      .from("skg_ai_knowledge_import_jobs")
      .select(
        "id, status, category_id, locale, extracted_char_count, original_filename",
      )
      .eq("id", id)
      .maybeSingle();

    if (loadError || !existing) {
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

    const status = String(existing.status);
    if (
      !isAiKnowledgeImportStatus(status) ||
      !canCreateArticlesFromImport(status)
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: "Review is only available after successful text extraction.",
        },
        { status: 400 },
      );
    }

    const patch: Record<string, unknown> = {};

    if ("edited_text" in body) {
      const edited = normalizeExtractedText(
        String((body as { edited_text?: unknown }).edited_text ?? ""),
      );
      if (!edited) {
        return NextResponse.json(
          { ok: false, error: "Edited text cannot be empty." },
          { status: 400 },
        );
      }
      if (edited.length > AI_KNOWLEDGE_IMPORT_MAX_TEXT_CHARS) {
        return NextResponse.json(
          { ok: false, error: "Edited text exceeds maximum length." },
          { status: 400 },
        );
      }
      patch.edited_text = edited;
      patch.preview_text = buildPreviewText(edited);
      patch.extracted_char_count = edited.length;
    }

    if ("category_id" in body) {
      const categoryId = (body as { category_id?: unknown }).category_id;
      if (categoryId == null || categoryId === "") {
        patch.category_id = null;
      } else if (!isAdminUuid(String(categoryId))) {
        return NextResponse.json(
          { ok: false, error: "Invalid category_id." },
          { status: 400 },
        );
      } else {
        patch.category_id = String(categoryId);
      }
    }

    if ("locale" in body) {
      const locale = (body as { locale?: unknown }).locale;
      if (locale == null || locale === "") {
        patch.locale = null;
      } else if (!isAiKnowledgeLocale(locale)) {
        return NextResponse.json(
          { ok: false, error: "locale must be en, hi, or gu." },
          { status: 400 },
        );
      } else {
        patch.locale = locale;
      }
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { ok: false, error: "No review changes provided." },
        { status: 400 },
      );
    }

    const { data, error } = await gate.supabase
      .from("skg_ai_knowledge_import_jobs")
      .update(patch)
      .eq("id", id)
      .select(
        `id, status, original_filename, preview_text, extracted_char_count,
         edited_text, category_id, locale, updated_at`,
      )
      .maybeSingle();

    if (error) {
      void recordFailure({
        ...auditBase,
        action: "help_ai.knowledge.import.review",
        description: `Failed to save import review ${id}`,
        reason: error.message,
      });
      return NextResponse.json(
        { ok: false, error: safeErrorMessage(error, "Failed to save review.") },
        { status: 500 },
      );
    }

    void recordChange({
      ...auditBase,
      action: "help_ai.knowledge.import.review",
      description: `Updated import review ${id}`,
      changedFields: Object.keys(patch),
      beforeData: importJobAuditSnapshot(existing as Record<string, unknown>),
      afterData: importJobAuditSnapshot(data as Record<string, unknown>),
    });

    return NextResponse.json({ ok: true, item: data });
  } catch (error) {
    void recordFailure({
      ...auditBase,
      action: "help_ai.knowledge.import.review",
      description: `Import review failed for ${id}`,
      reason: safeErrorMessage(error, "review_failed"),
    });
    return NextResponse.json(
      {
        ok: false,
        error: safeErrorMessage(error, "Failed to save review."),
      },
      { status: 500 },
    );
  }
}
