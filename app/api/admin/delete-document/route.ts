import { NextResponse } from "next/server";

import { requireAdminApi } from "@/lib/admin-api";
import {
  clientMetaFromRequest,
  recordFailure,
  recordSuccess,
} from "@/lib/admin-audit";

const IDENTITY_BUCKET = "identity-documents";

const allowedPathFields = [
  "driving_license_front_path",
  "driving_license_back_path",
  "aadhaar_front_path",
  "aadhaar_back_path",
  "aadhaar_file_path",
  "pan_file_path",
  "gst_file_path",
] as const;

type AllowedPathField = (typeof allowedPathFields)[number];

const legacyFlagByPathField: Partial<Record<AllowedPathField, string>> = {
  aadhaar_file_path: "aadhaar_uploaded",
  pan_file_path: "pan_uploaded",
  gst_file_path: "gst_uploaded",
};

type DeletePayload = {
  userId?: string;
  pathField?: string;
};

function isAllowedPathField(value: string): value is AllowedPathField {
  return allowedPathFields.includes(value as AllowedPathField);
}

export async function POST(request: Request) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;
  const supabaseAdmin = gate.supabase;

  const body = (await request.json().catch(() => ({}))) as DeletePayload;
  const userId = body.userId?.trim() ?? "";
  const pathField = body.pathField?.trim() ?? "";

  if (!userId || !pathField || !isAllowedPathField(pathField)) {
    return NextResponse.json({ ok: false, error: "Invalid request payload." }, { status: 400 });
  }

  // Never log storage paths for identity documents — only user + field name.
  const audit = {
    actor: gate.actor,
    module: "members",
    resourceType: "user_identity_document",
    resourceId: `${userId}:${pathField}`,
    relatedUserId: userId,
    metadata: { userId, pathField },
    ...clientMetaFromRequest(request),
  };

  const { data: row, error: readError } = await supabaseAdmin
    .from("user_identity_documents")
    .select(pathField)
    .eq("user_id", userId)
    .maybeSingle();

  if (readError) {
    void recordFailure({
      ...audit,
      action: "identity_document_deleted",
      description: `Failed to read identity document (${pathField}) for member ${userId}`,
      reason: readError.message,
    });
    return NextResponse.json({ ok: false, error: readError.message }, { status: 400 });
  }

  const rowRecord = row as Record<string, unknown> | null;
  const currentPath = rowRecord?.[pathField];
  if (typeof currentPath !== "string" || currentPath.length === 0) {
    void recordFailure({
      ...audit,
      action: "identity_document_deleted",
      description: `Identity document (${pathField}) not found for member ${userId}`,
      reason: "Document path not found.",
    });
    return NextResponse.json({ ok: false, error: "Document path not found." }, { status: 404 });
  }

  const { error: deleteStorageError } = await supabaseAdmin.storage
    .from(IDENTITY_BUCKET)
    .remove([currentPath]);

  if (deleteStorageError) {
    void recordFailure({
      ...audit,
      action: "identity_document_deleted",
      description: `Failed to remove identity document (${pathField}) from storage for member ${userId}`,
      reason: deleteStorageError.message,
    });
    return NextResponse.json({ ok: false, error: deleteStorageError.message }, { status: 400 });
  }

  const updatePayload: Record<string, unknown> = { [pathField]: null };
  const legacyFlag = legacyFlagByPathField[pathField];
  if (legacyFlag) {
    updatePayload[legacyFlag] = false;
  }

  const { error: updateError } = await supabaseAdmin
    .from("user_identity_documents")
    .update(updatePayload)
    .eq("user_id", userId);

  if (updateError) {
    void recordFailure({
      ...audit,
      action: "identity_document_deleted",
      outcome: "partial",
      description: `Identity document (${pathField}) removed from storage but database update failed for member ${userId}`,
      reason: updateError.message,
    });
    return NextResponse.json({ ok: false, error: updateError.message }, { status: 400 });
  }

  await recordSuccess({
    ...audit,
    action: "identity_document_deleted",
    description: `Identity document (${pathField}) deleted for member ${userId}`,
    changedFields: Object.keys(updatePayload),
  });

  return NextResponse.json({ ok: true });
}
