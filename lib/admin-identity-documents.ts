/**
 * Identity-document helpers for Admin Panel.
 *
 * Ownership model (discovered from this repo):
 * - Paths live in public.user_identity_documents columns.
 * - Storage bucket is always "identity-documents".
 * - Object keys are opaque strings written by the mobile/client app (not built here).
 * - Authoritative ownership is the DB row for user_id + pathField — never a
 *   client-supplied storage path.
 */

import type { AdminActor } from "@/lib/admin-rbac";
import { actorHasPermission } from "@/lib/admin-rbac";
import type { AdminPermission } from "@/lib/admin-permissions";

export const IDENTITY_DOCUMENTS_BUCKET = "identity-documents";

export const IDENTITY_PATH_FIELDS = [
  "driving_license_front_path",
  "driving_license_back_path",
  "aadhaar_front_path",
  "aadhaar_back_path",
  "aadhaar_file_path",
  "pan_file_path",
  "gst_file_path",
] as const;

export type IdentityPathField = (typeof IDENTITY_PATH_FIELDS)[number];

export const LEGACY_FLAG_BY_PATH_FIELD: Partial<
  Record<IdentityPathField, string>
> = {
  aadhaar_file_path: "aadhaar_uploaded",
  pan_file_path: "pan_uploaded",
  gst_file_path: "gst_uploaded",
};

/** Permissions that may mutate identity documents (existing catalog only). */
export const IDENTITY_DOCUMENT_MUTATE_PERMISSIONS: readonly AdminPermission[] = [
  "members.edit",
  "members.approve",
  "members.reject",
];

const USER_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const FORBIDDEN_CLIENT_PATH_KEYS = [
  "path",
  "storagePath",
  "storage_path",
  "objectPath",
  "object_path",
  "filePath",
  "file_path",
  "bucket",
  "url",
  "signedUrl",
  "signed_url",
] as const;

export function isAllowedIdentityPathField(
  value: string,
): value is IdentityPathField {
  return (IDENTITY_PATH_FIELDS as readonly string[]).includes(value);
}

export function isValidMemberUserId(userId: string): boolean {
  return USER_ID_RE.test(userId.trim());
}

export function actorCanMutateIdentityDocuments(actor: AdminActor): boolean {
  return IDENTITY_DOCUMENT_MUTATE_PERMISSIONS.some((permission) =>
    actorHasPermission(actor, permission),
  );
}

export type ParsedDeleteBody =
  | { ok: true; userId: string; pathField: IdentityPathField }
  | { ok: false; error: string };

/**
 * Parse delete request. Rejects client-supplied storage paths/buckets/URLs.
 * Only userId + pathField (DB column name) are accepted.
 */
export function parseIdentityDocumentDeleteBody(
  body: unknown,
): ParsedDeleteBody {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Invalid request payload." };
  }
  const record = body as Record<string, unknown>;

  for (const key of FORBIDDEN_CLIENT_PATH_KEYS) {
    if (key in record) {
      return {
        ok: false,
        error: "Storage path fields are not allowed in the request.",
      };
    }
  }

  const userId =
    typeof record.userId === "string" ? record.userId.trim() : "";
  const pathField =
    typeof record.pathField === "string" ? record.pathField.trim() : "";

  if (!userId || !pathField) {
    return { ok: false, error: "Invalid request payload." };
  }
  if (!isValidMemberUserId(userId)) {
    return { ok: false, error: "Invalid request payload." };
  }
  if (!isAllowedIdentityPathField(pathField)) {
    return { ok: false, error: "Invalid request payload." };
  }

  return { ok: true, userId, pathField };
}

export type StoragePathValidation =
  | { ok: true; path: string }
  | { ok: false; error: string };

/**
 * Validate a storage object key loaded from the database.
 * Rejects traversal, absolute URLs, bucket prefixes, and empty/malformed keys.
 * Does not invent a required path layout — this repo does not define one.
 */
export function validateIdentityStorageObjectPath(
  raw: string,
): StoragePathValidation {
  const path = raw.trim();
  if (!path) {
    return { ok: false, error: "Document path not found." };
  }
  if (path.length > 1024) {
    return { ok: false, error: "Invalid document path." };
  }
  if (path.includes("\0")) {
    return { ok: false, error: "Invalid document path." };
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) {
    return { ok: false, error: "Invalid document path." };
  }
  if (path.startsWith("/") || path.startsWith("\\")) {
    return { ok: false, error: "Invalid document path." };
  }
  if (path.includes("\\")) {
    return { ok: false, error: "Invalid document path." };
  }
  if (path.includes("..")) {
    return { ok: false, error: "Invalid document path." };
  }

  const segments = path.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return { ok: false, error: "Invalid document path." };
  }

  // Reject keys that try to name another bucket or absolute storage URL shape.
  const lowerFirst = segments[0]?.toLowerCase() ?? "";
  if (
    lowerFirst === IDENTITY_DOCUMENTS_BUCKET ||
    lowerFirst === "vehicle-documents" ||
    lowerFirst === "winner-images" ||
    lowerFirst === "announcement-assets" ||
    lowerFirst === "storage" ||
    lowerFirst === "object" ||
    lowerFirst === "v1"
  ) {
    return { ok: false, error: "Invalid document path." };
  }

  return { ok: true, path };
}

/**
 * Soft binding: if the first path segment is a UUID, it must equal the member
 * userId. Paths without a UUID prefix remain accepted (layout unknown in-repo).
 */
export function assertStoragePathConsistentWithUser(
  storagePath: string,
  userId: string,
): StoragePathValidation {
  const first = storagePath.split("/")[0] ?? "";
  if (USER_ID_RE.test(first) && first.toLowerCase() !== userId.toLowerCase()) {
    return {
      ok: false,
      error: "Document path does not belong to this user.",
    };
  }
  return { ok: true, path: storagePath };
}

export type ResolvedIdentityDeleteTarget =
  | {
      ok: true;
      userId: string;
      pathField: IdentityPathField;
      storagePath: string;
      legacyFlag: string | null;
    }
  | { ok: false; status: number; error: string };

/**
 * Resolve delete target from an authoritative DB row for the requested user.
 * Never uses a client-supplied storage path.
 */
export function resolveIdentityDocumentDeleteTarget(input: {
  userId: string;
  pathField: IdentityPathField;
  row: Record<string, unknown> | null;
}): ResolvedIdentityDeleteTarget {
  const { userId, pathField, row } = input;
  if (!row) {
    return { ok: false, status: 404, error: "Document path not found." };
  }

  const currentPath = row[pathField];
  if (typeof currentPath !== "string" || currentPath.trim().length === 0) {
    return { ok: false, status: 404, error: "Document path not found." };
  }

  const pathCheck = validateIdentityStorageObjectPath(currentPath);
  if (!pathCheck.ok) {
    return { ok: false, status: 400, error: pathCheck.error };
  }

  const bindCheck = assertStoragePathConsistentWithUser(pathCheck.path, userId);
  if (!bindCheck.ok) {
    return { ok: false, status: 400, error: bindCheck.error };
  }

  return {
    ok: true,
    userId,
    pathField,
    storagePath: pathCheck.path,
    legacyFlag: LEGACY_FLAG_BY_PATH_FIELD[pathField] ?? null,
  };
}

export function buildIdentityDocumentClearPayload(
  pathField: IdentityPathField,
  legacyFlag: string | null,
): Record<string, unknown> {
  const payload: Record<string, unknown> = { [pathField]: null };
  if (legacyFlag) {
    payload[legacyFlag] = false;
  }
  return payload;
}

/** Safe audit metadata — never includes object keys that look like signed URLs. */
export function buildIdentityDocumentDeleteAuditMetadata(input: {
  pathField: IdentityPathField;
  storagePath: string;
  bucket: string;
}): Record<string, unknown> {
  const segments = input.storagePath.split("/");
  return {
    pathField: input.pathField,
    bucket: input.bucket,
    // Path shape only — not a signed URL; truncate for safety in logs.
    objectKeySuffix:
      segments.length > 0
        ? segments[segments.length - 1]?.slice(0, 80) ?? null
        : null,
    objectKeyDepth: segments.length,
  };
}

export function auditPayloadLooksSafe(
  metadata: Record<string, unknown>,
): boolean {
  const serialized = JSON.stringify(metadata);
  if (/service_role|sb_secret_|eyJ[A-Za-z0-9_-]{20,}\./i.test(serialized)) {
    return false;
  }
  if (/https?:\/\//i.test(serialized)) {
    return false;
  }
  if (/token=|signature=/i.test(serialized)) {
    return false;
  }
  return true;
}
