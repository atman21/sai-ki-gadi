import { NextResponse } from "next/server";

import { requireAdminApi, safeErrorMessage } from "@/lib/admin-api";
import {
  clientMetaFromRequest,
  writeAdminAuditLog,
} from "@/lib/admin-audit";
import {
  IDENTITY_DOCUMENTS_BUCKET,
  actorCanMutateIdentityDocuments,
  buildIdentityDocumentClearPayload,
  buildIdentityDocumentDeleteAuditMetadata,
  parseIdentityDocumentDeleteBody,
  resolveIdentityDocumentDeleteTarget,
} from "@/lib/admin-identity-documents";

export async function POST(request: Request) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;
  const { supabase, actor } = gate;

  if (!actorCanMutateIdentityDocuments(actor)) {
    void writeAdminAuditLog({
      actor,
      action: "permission_denied",
      module: "members",
      description: "Permission denied for identity document delete",
      success: false,
      metadata: {
        requiredAnyOf: ["members.edit", "members.approve", "members.reject"],
      },
      ...clientMetaFromRequest(request),
    });
    return NextResponse.json(
      { ok: false, error: "Forbidden — insufficient permissions." },
      { status: 403 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as unknown;
  const parsed = parseIdentityDocumentDeleteBody(body);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  }

  const { userId, pathField } = parsed;

  // Storage folders are keyed by Auth UID — never compare against profile users.id.
  const { data: ownerRow, error: ownerError } = await supabase
    .from("users")
    .select("auth_user_id")
    .eq("id", userId)
    .maybeSingle();

  if (ownerError) {
    return NextResponse.json(
      {
        ok: false,
        error: safeErrorMessage(ownerError, "Failed to load user ownership."),
      },
      { status: 400 },
    );
  }

  const authUserId =
    typeof ownerRow?.auth_user_id === "string"
      ? ownerRow.auth_user_id.trim()
      : "";
  if (!authUserId) {
    return NextResponse.json(
      {
        ok: false,
        error: "User Auth UID is unavailable or invalid.",
      },
      { status: 400 },
    );
  }

  const { data: row, error: readError } = await supabase
    .from("user_identity_documents")
    .select(pathField)
    .eq("user_id", userId)
    .maybeSingle();

  if (readError) {
    return NextResponse.json(
      {
        ok: false,
        error: safeErrorMessage(readError, "Failed to load document."),
      },
      { status: 400 },
    );
  }

  const resolved = resolveIdentityDocumentDeleteTarget({
    userId,
    authUserId,
    pathField,
    row: (row as Record<string, unknown> | null) ?? null,
  });
  if (!resolved.ok) {
    return NextResponse.json(
      { ok: false, error: resolved.error },
      { status: resolved.status },
    );
  }

  const { error: deleteStorageError } = await supabase.storage
    .from(IDENTITY_DOCUMENTS_BUCKET)
    .remove([resolved.storagePath]);

  if (deleteStorageError) {
    void writeAdminAuditLog({
      actor,
      action: "identity_document_delete_failed",
      module: "members",
      description: `Failed to delete identity document (${pathField}) for user ${userId}`,
      success: false,
      resourceType: "user",
      resourceId: userId,
      metadata: {
        ...buildIdentityDocumentDeleteAuditMetadata({
          pathField,
          storagePath: resolved.storagePath,
          bucket: IDENTITY_DOCUMENTS_BUCKET,
        }),
        stage: "storage_remove",
      },
      ...clientMetaFromRequest(request),
    });
    return NextResponse.json(
      {
        ok: false,
        error: safeErrorMessage(
          deleteStorageError,
          "Failed to delete document file.",
        ),
      },
      { status: 400 },
    );
  }

  const updatePayload = buildIdentityDocumentClearPayload(
    pathField,
    resolved.legacyFlag,
  );

  const { data: updatedRow, error: updateError } = await supabase
    .from("user_identity_documents")
    .update(updatePayload)
    .eq("user_id", userId)
    .select(pathField)
    .maybeSingle();

  if (updateError) {
    void writeAdminAuditLog({
      actor,
      action: "identity_document_delete_failed",
      module: "members",
      description: `Storage removed but failed to clear identity document (${pathField}) for user ${userId}`,
      success: false,
      resourceType: "user",
      resourceId: userId,
      metadata: {
        ...buildIdentityDocumentDeleteAuditMetadata({
          pathField,
          storagePath: resolved.storagePath,
          bucket: IDENTITY_DOCUMENTS_BUCKET,
        }),
        stage: "database_clear",
      },
      ...clientMetaFromRequest(request),
    });
    return NextResponse.json(
      {
        ok: false,
        error: safeErrorMessage(
          updateError,
          "Failed to clear document path.",
        ),
      },
      { status: 400 },
    );
  }

  const clearedValue = (updatedRow as Record<string, unknown> | null)?.[
    pathField
  ];
  if (updatedRow == null || clearedValue) {
    void writeAdminAuditLog({
      actor,
      action: "identity_document_delete_failed",
      module: "members",
      description: `Failed to confirm identity document clear (${pathField}) for user ${userId}`,
      success: false,
      resourceType: "user",
      resourceId: userId,
      metadata: {
        ...buildIdentityDocumentDeleteAuditMetadata({
          pathField,
          storagePath: resolved.storagePath,
          bucket: IDENTITY_DOCUMENTS_BUCKET,
        }),
        stage: "database_confirm",
      },
      ...clientMetaFromRequest(request),
    });
    return NextResponse.json(
      { ok: false, error: "Failed to clear document path." },
      { status: 400 },
    );
  }

  const actorLabel = actor.displayName || actor.username || "admin";
  void writeAdminAuditLog({
    actor,
    action: "identity_document_deleted",
    module: "members",
    description: `Identity document ${pathField} deleted for user ${userId} by ${actorLabel}`,
    success: true,
    resourceType: "user",
    resourceId: userId,
    changedFields: resolved.legacyFlag
      ? [pathField, resolved.legacyFlag]
      : [pathField],
    beforeData: { [pathField]: "(present)" },
    afterData: { [pathField]: null },
    metadata: buildIdentityDocumentDeleteAuditMetadata({
      pathField,
      storagePath: resolved.storagePath,
      bucket: IDENTITY_DOCUMENTS_BUCKET,
    }),
    ...clientMetaFromRequest(request),
  });

  return NextResponse.json({ ok: true });
}
