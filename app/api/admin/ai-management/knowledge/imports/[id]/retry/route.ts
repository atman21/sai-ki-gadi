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
  canRetryImport,
  importJobAuditSnapshot,
  isAiKnowledgeImportStatus,
} from "@/lib/ai-knowledge-import";
import { processImportJob } from "@/lib/ai-knowledge-import-process";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST — retry failed/uploaded extraction (help_ai.manage)
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
    const { data: existing, error } = await gate.supabase
      .from("skg_ai_knowledge_import_jobs")
      .select("id, status, original_filename, format, byte_size, content_sha256")
      .eq("id", id)
      .maybeSingle();

    if (error || !existing) {
      return NextResponse.json(
        {
          ok: false,
          error: error
            ? safeErrorMessage(error, "Failed to load import job.")
            : "Import job not found.",
        },
        { status: error ? 500 : 404 },
      );
    }

    const status = String(existing.status);
    if (!isAiKnowledgeImportStatus(status) || !canRetryImport(status)) {
      return NextResponse.json(
        { ok: false, error: "Only failed or uploaded jobs can be retried." },
        { status: 400 },
      );
    }

    const processed = await processImportJob({
      supabase: gate.supabase,
      jobId: id,
    });

    void recordChange({
      ...auditBase,
      action: "help_ai.knowledge.import.retry",
      description: processed.ok
        ? `Retry extraction succeeded for ${id}`
        : `Retry extraction failed for ${id}`,
      changedFields: ["status"],
      beforeData: importJobAuditSnapshot(existing as Record<string, unknown>),
      afterData: {
        status: processed.status,
        ok: processed.ok,
        error: processed.ok ? null : processed.error,
      },
    });

    const { data: fresh } = await gate.supabase
      .from("skg_ai_knowledge_import_jobs")
      .select(
        `id, status, original_filename, format, preview_text, extracted_char_count,
         edited_text, extracted_text, error_summary, processed_at, updated_at`,
      )
      .eq("id", id)
      .maybeSingle();

    return NextResponse.json({
      ok: processed.ok,
      item: fresh,
      error: processed.ok ? null : processed.error,
    });
  } catch (error) {
    void recordFailure({
      ...auditBase,
      action: "help_ai.knowledge.import.retry",
      description: `Retry failed for ${id}`,
      reason: safeErrorMessage(error, "retry_failed"),
    });
    return NextResponse.json(
      {
        ok: false,
        error: safeErrorMessage(error, "Retry failed."),
      },
      { status: 500 },
    );
  }
}
