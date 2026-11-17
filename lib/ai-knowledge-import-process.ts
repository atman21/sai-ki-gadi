/**
 * Server-side import processing: download from private storage → extract → update job.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { extractKnowledgeImportText } from "@/lib/ai-knowledge-import-extract";
import {
  AI_KNOWLEDGE_IMPORT_BUCKET,
  AI_KNOWLEDGE_IMPORT_PARSER_VERSION,
  buildPreviewText,
  type AiKnowledgeImportFormat,
} from "@/lib/ai-knowledge-import";

export async function processImportJob(args: {
  supabase: SupabaseClient;
  jobId: string;
}): Promise<
  | { ok: true; status: "extracted"; charCount: number }
  | { ok: false; status: "failed"; error: string }
> {
  const { supabase, jobId } = args;

  const { data: job, error: loadError } = await supabase
    .from("skg_ai_knowledge_import_jobs")
    .select(
      "id, status, format, storage_bucket, storage_path, original_filename",
    )
    .eq("id", jobId)
    .maybeSingle();

  if (loadError || !job) {
    return {
      ok: false,
      status: "failed",
      error: loadError?.message ?? "Import job not found.",
    };
  }

  await supabase
    .from("skg_ai_knowledge_import_jobs")
    .update({
      status: "processing",
      error_summary: null,
      processed_at: null,
    })
    .eq("id", jobId);

  const bucket = String(job.storage_bucket || AI_KNOWLEDGE_IMPORT_BUCKET);
  const path = String(job.storage_path);
  const { data: blob, error: downloadError } = await supabase.storage
    .from(bucket)
    .download(path);

  if (downloadError || !blob) {
    const message = downloadError?.message ?? "Failed to download stored file.";
    await supabase
      .from("skg_ai_knowledge_import_jobs")
      .update({
        status: "failed",
        error_summary: message.slice(0, 1000),
        processed_at: new Date().toISOString(),
      })
      .eq("id", jobId);
    return { ok: false, status: "failed", error: message };
  }

  const buffer = Buffer.from(await blob.arrayBuffer());
  const extracted = await extractKnowledgeImportText(
    job.format as AiKnowledgeImportFormat,
    buffer,
  );

  if (!extracted.ok) {
    await supabase
      .from("skg_ai_knowledge_import_jobs")
      .update({
        status: "failed",
        error_summary: extracted.error.slice(0, 1000),
        extracted_text: null,
        edited_text: null,
        preview_text: null,
        extracted_char_count: 0,
        processed_at: new Date().toISOString(),
        parser_version: AI_KNOWLEDGE_IMPORT_PARSER_VERSION,
      })
      .eq("id", jobId);
    return { ok: false, status: "failed", error: extracted.error };
  }

  const preview = buildPreviewText(extracted.text);
  await supabase
    .from("skg_ai_knowledge_import_jobs")
    .update({
      status: "extracted",
      extracted_text: extracted.text,
      edited_text: extracted.text,
      preview_text: preview,
      extracted_char_count: extracted.text.length,
      error_summary: null,
      processed_at: new Date().toISOString(),
      parser_version: `${AI_KNOWLEDGE_IMPORT_PARSER_VERSION}:${extracted.parser}`,
    })
    .eq("id", jobId);

  return {
    ok: true,
    status: "extracted",
    charCount: extracted.text.length,
  };
}
