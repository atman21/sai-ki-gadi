/**
 * Postgres persistence for AI Instructions (Phase 2D).
 *
 * Source of truth: public.skg_ai_instructions (+ versions).
 * Filesystem adapter is retired — Gemini mint loads global-published only.
 */

import {
  AI_INSTRUCTION_DOCUMENT_ID,
  composeFinalInstruction,
  defaultAiInstructionDocument,
  defaultAiInstructionFields,
  fieldsFromDocument,
  type AiInstructionDocument,
  type AiInstructionFields,
  type AiInstructionVersionEntry,
} from "@/lib/ai-instructions";
import { supabaseAdmin } from "@/lib/supabase-admin";

const DRAFT_ID = "global-draft";
const PUBLISHED_ID = "global-published";

type InstructionRow = {
  id: string;
  status: "draft" | "published";
  version: number;
  title: string;
  main_system_instruction: string;
  skg_scope_restriction: string;
  allowed_topics: string[] | null;
  refusal_message: string;
  fallback_message: string;
  language_behavior: string;
  composed_text: string;
  published_at: string | null;
  published_by: string | null;
  published_version: number | null;
  updated_at: string | null;
  updated_by: string | null;
};

type VersionRow = {
  version: number;
  status: "draft" | "published";
  change_reason: string;
  changed_by: string | null;
  created_at: string;
  title: string;
  main_system_instruction: string;
  skg_scope_restriction: string;
  allowed_topics: string[] | null;
  refusal_message: string;
  fallback_message: string;
  language_behavior: string;
};

function fieldsFromRow(row: InstructionRow | VersionRow): AiInstructionFields {
  return {
    title: row.title,
    main_system_instruction: row.main_system_instruction,
    skg_scope_restriction: row.skg_scope_restriction,
    allowed_topics: Array.isArray(row.allowed_topics)
      ? (row.allowed_topics as AiInstructionFields["allowed_topics"])
      : [],
    refusal_message: row.refusal_message,
    fallback_message: row.fallback_message,
    language_behavior: row.language_behavior,
  };
}

function documentFromRow(row: InstructionRow): AiInstructionDocument {
  return {
    id: AI_INSTRUCTION_DOCUMENT_ID,
    status: row.status,
    version: row.version,
    updated_at: row.updated_at,
    updated_by: row.updated_by,
    published_at: row.published_at,
    published_by: row.published_by,
    published_version: row.published_version,
    ...fieldsFromRow(row),
  };
}

function rowPayloadFromFields(args: {
  id: typeof DRAFT_ID | typeof PUBLISHED_ID;
  status: "draft" | "published";
  version: number;
  fields: AiInstructionFields;
  actorId: string | null;
  publishedAt: string | null;
  publishedBy: string | null;
  publishedVersion: number | null;
}) {
  const composed_text = composeFinalInstruction(args.fields);
  return {
    id: args.id,
    document_key: "global",
    status: args.status,
    version: args.version,
    title: args.fields.title,
    main_system_instruction: args.fields.main_system_instruction,
    skg_scope_restriction: args.fields.skg_scope_restriction,
    allowed_topics: args.fields.allowed_topics,
    refusal_message: args.fields.refusal_message,
    fallback_message: args.fields.fallback_message,
    language_behavior: args.fields.language_behavior,
    composed_text,
    published_at: args.publishedAt,
    published_by: args.publishedBy,
    published_version: args.publishedVersion,
    updated_by: args.actorId,
  };
}

async function fetchRow(id: string): Promise<InstructionRow | null> {
  const { data, error } = await supabaseAdmin
    .from("skg_ai_instructions")
    .select(
      "id,status,version,title,main_system_instruction,skg_scope_restriction,allowed_topics,refusal_message,fallback_message,language_behavior,composed_text,published_at,published_by,published_version,updated_at,updated_by",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as InstructionRow | null) ?? null;
}

async function ensureDraftSeeded(): Promise<InstructionRow> {
  const existing = await fetchRow(DRAFT_ID);
  if (existing) return existing;

  const defaults = defaultAiInstructionFields();
  const payload = rowPayloadFromFields({
    id: DRAFT_ID,
    status: "draft",
    version: 1,
    fields: defaults,
    actorId: null,
    publishedAt: null,
    publishedBy: null,
    publishedVersion: null,
  });
  const { data, error } = await supabaseAdmin
    .from("skg_ai_instructions")
    .upsert(payload, { onConflict: "id" })
    .select(
      "id,status,version,title,main_system_instruction,skg_scope_restriction,allowed_topics,refusal_message,fallback_message,language_behavior,composed_text,published_at,published_by,published_version,updated_at,updated_by",
    )
    .single();
  if (error) throw error;
  return data as InstructionRow;
}

async function appendVersionEntry(entry: {
  version: number;
  status: "draft" | "published";
  change_reason: string;
  changed_by: string | null;
  fields: AiInstructionFields;
}) {
  const composed_text = composeFinalInstruction(entry.fields);
  const { error } = await supabaseAdmin.from("skg_ai_instruction_versions").insert({
    document_key: "global",
    version: entry.version,
    status: entry.status,
    change_reason: entry.change_reason,
    changed_by: entry.changed_by,
    title: entry.fields.title,
    main_system_instruction: entry.fields.main_system_instruction,
    skg_scope_restriction: entry.fields.skg_scope_restriction,
    allowed_topics: entry.fields.allowed_topics,
    refusal_message: entry.fields.refusal_message,
    fallback_message: entry.fields.fallback_message,
    language_behavior: entry.fields.language_behavior,
    composed_text,
  });
  if (error) throw error;
}

export type InstructionsStoreSnapshot = {
  storage: "postgres";
  storage_path: string;
  draft: AiInstructionDocument;
  published: AiInstructionDocument | null;
  preview_text: string;
  gemini_runtime_enforced: true;
  integration_note: string;
};

export async function loadInstructionsSnapshot(): Promise<InstructionsStoreSnapshot> {
  const draftRow = await ensureDraftSeeded();
  const publishedRow = await fetchRow(PUBLISHED_ID);

  const draft = documentFromRow(draftRow);
  const published = publishedRow ? documentFromRow(publishedRow) : null;

  return {
    storage: "postgres",
    storage_path: "public.skg_ai_instructions",
    draft,
    published,
    preview_text: composeFinalInstruction(fieldsFromDocument(draft)),
    gemini_runtime_enforced: true,
    integration_note:
      "Published instructions are stored in Postgres. mint-skg-ai-live-token injects global-published into Gemini Live systemInstruction (deploy required).",
  };
}

export async function saveInstructionDraft(args: {
  fields: AiInstructionFields;
  actorId: string | null;
}): Promise<AiInstructionDocument> {
  const snapshot = await loadInstructionsSnapshot();
  const previous = snapshot.draft;
  const nextVersion = Math.max(1, Number(previous.version) || 1) + 1;

  const payload = rowPayloadFromFields({
    id: DRAFT_ID,
    status: "draft",
    version: nextVersion,
    fields: args.fields,
    actorId: args.actorId,
    publishedAt: previous.published_at,
    publishedBy: previous.published_by,
    publishedVersion: previous.published_version,
  });

  const { data, error } = await supabaseAdmin
    .from("skg_ai_instructions")
    .upsert(payload, { onConflict: "id" })
    .select(
      "id,status,version,title,main_system_instruction,skg_scope_restriction,allowed_topics,refusal_message,fallback_message,language_behavior,composed_text,published_at,published_by,published_version,updated_at,updated_by",
    )
    .single();
  if (error) throw error;

  await appendVersionEntry({
    version: nextVersion,
    status: "draft",
    change_reason: "save_draft",
    changed_by: args.actorId,
    fields: args.fields,
  });

  return documentFromRow(data as InstructionRow);
}

export async function publishInstructionDraft(args: {
  actorId: string | null;
  changeReason?: string;
}): Promise<{
  draft: AiInstructionDocument;
  published: AiInstructionDocument;
}> {
  const snapshot = await loadInstructionsSnapshot();
  const now = new Date().toISOString();
  const nextVersion = Math.max(1, Number(snapshot.draft.version) || 1) + 1;
  const fields = fieldsFromDocument(snapshot.draft);

  const publishedPayload = rowPayloadFromFields({
    id: PUBLISHED_ID,
    status: "published",
    version: nextVersion,
    fields,
    actorId: args.actorId,
    publishedAt: now,
    publishedBy: args.actorId,
    publishedVersion: nextVersion,
  });

  const draftPayload = rowPayloadFromFields({
    id: DRAFT_ID,
    status: "draft",
    version: nextVersion,
    fields,
    actorId: args.actorId,
    publishedAt: now,
    publishedBy: args.actorId,
    publishedVersion: nextVersion,
  });

  const { data: publishedData, error: publishedError } = await supabaseAdmin
    .from("skg_ai_instructions")
    .upsert(publishedPayload, { onConflict: "id" })
    .select(
      "id,status,version,title,main_system_instruction,skg_scope_restriction,allowed_topics,refusal_message,fallback_message,language_behavior,composed_text,published_at,published_by,published_version,updated_at,updated_by",
    )
    .single();
  if (publishedError) throw publishedError;

  const { data: draftData, error: draftError } = await supabaseAdmin
    .from("skg_ai_instructions")
    .upsert(draftPayload, { onConflict: "id" })
    .select(
      "id,status,version,title,main_system_instruction,skg_scope_restriction,allowed_topics,refusal_message,fallback_message,language_behavior,composed_text,published_at,published_by,published_version,updated_at,updated_by",
    )
    .single();
  if (draftError) throw draftError;

  await appendVersionEntry({
    version: nextVersion,
    status: "published",
    change_reason: args.changeReason?.trim() || "publish",
    changed_by: args.actorId,
    fields,
  });

  return {
    draft: documentFromRow(draftData as InstructionRow),
    published: documentFromRow(publishedData as InstructionRow),
  };
}

export async function listInstructionVersions(
  limit = 30,
): Promise<AiInstructionVersionEntry[]> {
  const { data, error } = await supabaseAdmin
    .from("skg_ai_instruction_versions")
    .select(
      "version,status,change_reason,changed_by,created_at,title,main_system_instruction,skg_scope_restriction,allowed_topics,refusal_message,fallback_message,language_behavior",
    )
    .eq("document_key", "global")
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(100, limit)));
  if (error) throw error;

  const rows = (data ?? []) as VersionRow[];
  return rows.map((row) => ({
    version: row.version,
    status: row.status,
    change_reason: row.change_reason,
    changed_by: row.changed_by,
    created_at: row.created_at,
    snapshot: fieldsFromRow(row),
  }));
}

/** @deprecated Filesystem path removed in Phase 2D — kept for test discovery. */
export function getInstructionsStoreDirForTests() {
  return "public.skg_ai_instructions";
}

export function getDefaultDocumentForTests() {
  return defaultAiInstructionDocument();
}
