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
  AI_KNOWLEDGE_IMPORT_BUCKET,
  canCancelImport,
  canDeleteImport,
  importJobAuditSnapshot,
  isAiKnowledgeImportStatus,
} from "@/lib/ai-knowledge-import";

type Ctx = { params: Promise<{ id: string }> };

const DETAIL_SELECT = `
  id, status, original_filename, safe_filename, format, content_type, byte_size,
  content_sha256, storage_bucket, storage_path, extracted_text, edited_text,
  preview_text, extracted_char_count, category_id, locale, error_summary,
  parser_version, created_article_ids, uploaded_by, processed_at, created_at, updated_at
`;

/**
 * GET — import job detail + optional signed URL (help_ai.manage)
 */
export async function GET(request: Request, context: Ctx) {
  const gate = await requireAdminPermission("help_ai.manage", {
    request,
    auditModule: "help_ai",
  });
  if (!gate.ok) return gate.response;

  const { id } = await context.params;
  if (!isAdminUuid(id)) {
    return NextResponse.json({ ok: false, error: "Invalid job id." }, { status: 400 });
  }

  try {
    const { data, error } = await gate.supabase
      .from("skg_ai_knowledge_import_jobs")
      .select(DETAIL_SELECT)
      .eq("id", id)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          error: safeErrorMessage(error, "Failed to load import job."),
        },
        { status: 500 },
      );
    }
    if (!data) {
      return NextResponse.json(
        { ok: false, error: "Import job not found." },
        { status: 404 },
      );
    }

    let signedUrl: string | null = null;
    const bucket = String(data.storage_bucket || AI_KNOWLEDGE_IMPORT_BUCKET);
    const path = String(data.storage_path || "");
    if (path) {
      const { data: signed } = await gate.supabase.storage
        .from(bucket)
        .createSignedUrl(path, 3600);
      signedUrl = signed?.signedUrl ?? null;
    }

    return NextResponse.json({
      ok: true,
      item: {
        ...data,
        storage_path: undefined, // do not expose raw path unnecessarily
        signed_url: signedUrl,
        signed_url_expires_seconds: 3600,
        gemini_eligible: false,
      },
      note: "Signed URL is Admin-only and time-limited. Content is not Gemini-accessible.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: safeErrorMessage(error, "Failed to load import job."),
      },
      { status: 500 },
    );
  }
}

/**
 * DELETE — cancel or hard-delete import (help_ai.manage)
 * Query: ?mode=cancel|delete (default cancel)
 */
export async function DELETE(request: Request, context: Ctx) {
  const gate = await requireAdminPermission("help_ai.manage", {
    request,
    auditModule: "help_ai",
  });
  if (!gate.ok) return gate.response;

  const { id } = await context.params;
  if (!isAdminUuid(id)) {
    return NextResponse.json({ ok: false, error: "Invalid job id." }, { status: 400 });
  }

  const mode =
    new URL(request.url).searchParams.get("mode") === "delete"
      ? "delete"
      : "cancel";

  const auditBase = {
    actor: gate.actor,
    module: "help_ai",
    resourceType: "skg_ai_knowledge_import_job",
    resourceId: id,
    ...clientMetaFromRequest(request),
  };

  try {
    const { data: existing, error: loadError } = await gate.supabase
      .from("skg_ai_knowledge_import_jobs")
      .select(DETAIL_SELECT)
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
    if (!isAiKnowledgeImportStatus(status)) {
      return NextResponse.json(
        { ok: false, error: "Invalid job status." },
        { status: 500 },
      );
    }

    if (mode === "cancel") {
      if (!canCancelImport(status) || status === "cancelled") {
        return NextResponse.json(
          { ok: false, error: "Import cannot be cancelled in its current status." },
          { status: 400 },
        );
      }
      const { data, error } = await gate.supabase
        .from("skg_ai_knowledge_import_jobs")
        .update({ status: "cancelled" })
        .eq("id", id)
        .select("id, status, original_filename")
        .maybeSingle();
      if (error) {
        void recordFailure({
          ...auditBase,
          action: "help_ai.knowledge.import.cancel",
          description: `Failed to cancel import ${id}`,
          reason: error.message,
        });
        return NextResponse.json(
          { ok: false, error: safeErrorMessage(error, "Cancel failed.") },
          { status: 500 },
        );
      }
      void recordChange({
        ...auditBase,
        action: "help_ai.knowledge.import.cancel",
        description: `Cancelled knowledge import ${id}`,
        changedFields: ["status"],
        beforeData: importJobAuditSnapshot(existing as Record<string, unknown>),
        afterData: importJobAuditSnapshot(data as Record<string, unknown>),
      });
      return NextResponse.json({ ok: true, item: data });
    }

    if (!canDeleteImport(status)) {
      return NextResponse.json(
        { ok: false, error: "Cannot delete while processing." },
        { status: 400 },
      );
    }

    const path = String(existing.storage_path || "");
    const bucket = String(existing.storage_bucket || AI_KNOWLEDGE_IMPORT_BUCKET);
    if (path) {
      await gate.supabase.storage.from(bucket).remove([path]);
    }

    const { error: delError } = await gate.supabase
      .from("skg_ai_knowledge_import_jobs")
      .delete()
      .eq("id", id);

    if (delError) {
      void recordFailure({
        ...auditBase,
        action: "help_ai.knowledge.import.delete",
        description: `Failed to delete import ${id}`,
        reason: delError.message,
      });
      return NextResponse.json(
        { ok: false, error: safeErrorMessage(delError, "Delete failed.") },
        { status: 500 },
      );
    }

    void recordChange({
      ...auditBase,
      action: "help_ai.knowledge.import.delete",
      description: `Deleted knowledge import ${id}`,
      changedFields: ["deleted"],
      beforeData: importJobAuditSnapshot(existing as Record<string, unknown>),
      afterData: { deleted: true },
    });

    return NextResponse.json({ ok: true, deleted: true });
  } catch (error) {
    void recordFailure({
      ...auditBase,
      action: "help_ai.knowledge.import.delete",
      description: `Import delete/cancel failed for ${id}`,
      reason: safeErrorMessage(error, "delete_failed"),
    });
    return NextResponse.json(
      {
        ok: false,
        error: safeErrorMessage(error, "Delete/cancel failed."),
      },
      { status: 500 },
    );
  }
}
