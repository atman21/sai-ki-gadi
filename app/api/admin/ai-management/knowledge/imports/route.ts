import { randomUUID } from "node:crypto";

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
import {
  AI_KNOWLEDGE_IMPORT_BUCKET,
  AI_KNOWLEDGE_IMPORT_PARSER_VERSION,
  buildStoragePath,
  importJobAuditSnapshot,
  isAiKnowledgeImportStatus,
  validateImportUpload,
} from "@/lib/ai-knowledge-import";
import { processImportJob } from "@/lib/ai-knowledge-import-process";

const LIST_SELECT = `
  id, status, original_filename, safe_filename, format, content_type, byte_size,
  content_sha256, preview_text, extracted_char_count, category_id, locale,
  error_summary, created_article_ids, uploaded_by, processed_at, created_at, updated_at
`;

/**
 * GET — list import jobs (help_ai.view for read; tab is manage-gated in nav).
 * Use help_ai.manage to match tab permission (both view+manage are manage).
 */
export async function GET(request: Request) {
  const gate = await requireAdminPermission("help_ai.manage", {
    request,
    auditModule: "help_ai",
  });
  if (!gate.ok) return gate.response;

  try {
    const { searchParams } = new URL(request.url);
    const q = (searchParams.get("q") ?? "").trim().slice(0, 120);
    const statusRaw = searchParams.get("status");
    const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, Number(searchParams.get("page_size") ?? "25") || 25),
    );

    if (statusRaw && !isAiKnowledgeImportStatus(statusRaw)) {
      return NextResponse.json(
        { ok: false, error: "Invalid status filter." },
        { status: 400 },
      );
    }

    let query = gate.supabase
      .from("skg_ai_knowledge_import_jobs")
      .select(LIST_SELECT, { count: "exact" })
      .order("created_at", { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);

    if (statusRaw) query = query.eq("status", statusRaw);
    if (q) query = query.ilike("original_filename", `%${q}%`);

    const { data, error, count } = await query;
    if (error) {
      return NextResponse.json(
        {
          ok: false,
          error: safeErrorMessage(error, "Failed to load import jobs."),
          migration_required: true,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      items: data ?? [],
      total: typeof count === "number" ? count : (data ?? []).length,
      page,
      page_size: pageSize,
      limits: {
        max_bytes: 5 * 1024 * 1024,
        formats: ["pdf", "docx", "txt", "md"],
      },
      gemini_import_auto_publish: false,
      storage_bucket: AI_KNOWLEDGE_IMPORT_BUCKET,
      storage_public: false,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: safeErrorMessage(error, "Failed to load import jobs."),
      },
      { status: 500 },
    );
  }
}

/**
 * POST — upload document (multipart), store privately, create job, extract text.
 * Requires help_ai.manage. Never auto-publishes articles.
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
    resourceType: "skg_ai_knowledge_import_job",
    ...clientMetaFromRequest(request),
  };

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!file || typeof file !== "object" || !("arrayBuffer" in file)) {
      return NextResponse.json(
        { ok: false, error: "No file uploaded." },
        { status: 400 },
      );
    }
    const upload = file as File;
    const buffer = Buffer.from(await upload.arrayBuffer());
    const validated = validateImportUpload({
      filename: upload.name || "upload.bin",
      mimeType: upload.type || "",
      byteSize: buffer.length,
      buffer,
    });
    if (!validated.ok) {
      return NextResponse.json(
        { ok: false, error: validated.error },
        { status: 400 },
      );
    }

    const jobId = randomUUID();
    const storagePath = buildStoragePath(jobId, validated.safeFilename);

    const { error: uploadError } = await gate.supabase.storage
      .from(AI_KNOWLEDGE_IMPORT_BUCKET)
      .upload(storagePath, buffer, {
        contentType: validated.contentType,
        upsert: false,
      });

    if (uploadError) {
      void recordFailure({
        ...auditBase,
        resourceId: jobId,
        action: "help_ai.knowledge.import.upload",
        description: `Failed to store import file ${validated.safeFilename}`,
        reason: uploadError.message,
        metadata: {
          format: validated.format,
          byte_size: buffer.length,
          sha256: validated.sha256,
          bucket: AI_KNOWLEDGE_IMPORT_BUCKET,
        },
      });
      return NextResponse.json(
        {
          ok: false,
          error: safeErrorMessage(
            uploadError,
            "Failed to store file in private bucket.",
          ),
        },
        { status: 500 },
      );
    }

    const { data: job, error: insertError } = await gate.supabase
      .from("skg_ai_knowledge_import_jobs")
      .insert({
        id: jobId,
        status: "uploaded",
        original_filename: upload.name.slice(0, 260),
        safe_filename: validated.safeFilename,
        format: validated.format,
        content_type: validated.contentType,
        byte_size: buffer.length,
        content_sha256: validated.sha256,
        storage_bucket: AI_KNOWLEDGE_IMPORT_BUCKET,
        storage_path: storagePath,
        uploaded_by: gate.actor.id,
        parser_version: AI_KNOWLEDGE_IMPORT_PARSER_VERSION,
      })
      .select(LIST_SELECT)
      .maybeSingle();

    if (insertError || !job) {
      await gate.supabase.storage
        .from(AI_KNOWLEDGE_IMPORT_BUCKET)
        .remove([storagePath]);
      void recordFailure({
        ...auditBase,
        resourceId: jobId,
        action: "help_ai.knowledge.import.upload",
        description: "Failed to create import job record",
        reason: insertError?.message ?? "insert_failed",
      });
      return NextResponse.json(
        {
          ok: false,
          error: safeErrorMessage(insertError, "Failed to create import job."),
        },
        { status: 500 },
      );
    }

    void recordChange({
      ...auditBase,
      resourceId: jobId,
      action: "help_ai.knowledge.import.upload",
      description: `Uploaded knowledge import ${validated.safeFilename}`,
      changedFields: ["status", "storage_path", "format"],
      afterData: importJobAuditSnapshot(job as Record<string, unknown>),
    });

    const processed = await processImportJob({
      supabase: gate.supabase,
      jobId,
    });

    void recordChange({
      ...auditBase,
      resourceId: jobId,
      action: "help_ai.knowledge.import.process",
      description: processed.ok
        ? `Extracted text from import ${jobId}`
        : `Extraction failed for import ${jobId}`,
      changedFields: ["status", "extracted_char_count"],
      afterData: {
        status: processed.status,
        ok: processed.ok,
        error: processed.ok ? null : processed.error,
        char_count: processed.ok ? processed.charCount : 0,
      },
    });

    const { data: fresh } = await gate.supabase
      .from("skg_ai_knowledge_import_jobs")
      .select(`${LIST_SELECT}, extracted_text, edited_text`)
      .eq("id", jobId)
      .maybeSingle();

    return NextResponse.json(
      {
        ok: true,
        item: publicImportJob(fresh ?? job),
        extraction_ok: processed.ok,
        extraction_error: processed.ok ? null : processed.error,
        note: "Imported content is untrusted and not published. Create draft articles after review.",
      },
      { status: 201 },
    );
  } catch (error) {
    void recordFailure({
      ...auditBase,
      action: "help_ai.knowledge.import.upload",
      description: "Knowledge import upload failed",
      reason: safeErrorMessage(error, "upload_failed"),
    });
    return NextResponse.json(
      {
        ok: false,
        error: safeErrorMessage(error, "Upload failed."),
      },
      { status: 500 },
    );
  }
}

function publicImportJob(row: Record<string, unknown> | null) {
  if (!row) return null;
  // Never return storage_path to clients? Actually Admin needs it for nothing if we use signed URLs separately.
  // Omit full extracted_text in list; include in detail. Here POST returns detail.
  return {
    id: row.id,
    status: row.status,
    original_filename: row.original_filename,
    safe_filename: row.safe_filename,
    format: row.format,
    content_type: row.content_type,
    byte_size: row.byte_size,
    content_sha256: row.content_sha256,
    preview_text: row.preview_text ?? null,
    extracted_char_count: row.extracted_char_count ?? 0,
    edited_text: row.edited_text ?? null,
    extracted_text: row.extracted_text ?? null,
    category_id: row.category_id ?? null,
    locale: row.locale ?? null,
    error_summary: row.error_summary ?? null,
    created_article_ids: row.created_article_ids ?? [],
    uploaded_by: row.uploaded_by ?? null,
    processed_at: row.processed_at ?? null,
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
    gemini_eligible: false,
  };
}

