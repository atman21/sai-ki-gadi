/**
 * Identity-document helpers for Admin Panel.
 *
 * Confirmed ownership model (A6/A7):
 * - public.users.id = application profile ID (user_identity_documents.user_id).
 * - public.users.auth_user_id = Supabase Auth UID.
 * - Mobile Storage keys: `{auth.uid()}/{docKey}-{timestamp}.jpg`
 * - Bucket: identity-documents (private).
 * - Admin must compare the first path segment to auth_user_id — never users.id.
 *
 * Legacy / opaque keys without an Auth-UID folder are rejected (fail closed).
 * Manual recovery: see LEGACY_IDENTITY_DOCUMENT_RECOVERY below.
 */

import type { AdminActor } from "@/lib/admin-rbac";
import { actorHasPermission } from "@/lib/admin-rbac";
import type { AdminPermission } from "@/lib/admin-permissions";

export const IDENTITY_DOCUMENTS_BUCKET = "identity-documents";

/**
 * Known formats from Admin Web + confirmed mobile convention.
 * No ownership is guessed for formats that lack an Auth-UID folder.
 */
export const KNOWN_IDENTITY_PATH_FORMATS = [
  {
    id: "mobile_auth_uid_folder",
    description:
      "{auth.uid()}/{docKey}-{timestamp}.jpg — current mobile upload layout",
    ownership: "first_segment_equals_auth_user_id",
  },
  {
    id: "legacy_column_aadhaar_pan_gst",
    description:
      "Legacy DB columns aadhaar_file_path / pan_file_path / gst_file_path may store older keys",
    ownership: "fail_closed_unless_auth_uid_prefix",
  },
  {
    id: "opaque_or_unprefixed",
    description:
      "Keys without a UUID first segment (e.g. uploads/…, bare filenames)",
    ownership: "rejected",
  },
  {
    id: "profile_id_prefixed",
    description:
      "Keys whose first segment is users.id (profile) instead of auth_user_id",
    ownership: "rejected_must_use_auth_user_id",
  },
] as const;

/**
 * Manual review / recovery for legacy documents (no auto-migration):
 * 1. Identify the member (users.id) and load users.auth_user_id.
 * 2. Inspect the stored path on user_identity_documents.
 * 3. If the first segment ≠ auth_user_id, do not sign or delete via Admin Web.
 * 4. Have an authorized operator locate the object in the private
 *    identity-documents bucket and confirm ownership out-of-band.
 * 5. Optionally re-upload via the mobile app (writes Auth-UID prefix) or
 *    manually correct the DB path after verified Storage move — outside
 *    this Admin Web change set.
 */
export const LEGACY_IDENTITY_DOCUMENT_RECOVERY =
  "Fail closed in Admin Web. Review Storage object ownership manually; re-upload via mobile or correct path only after verified Auth-UID ownership.";

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

const UUID_RE =
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

export function isValidUuid(value: string): boolean {
  return UUID_RE.test(value.trim());
}

/** Profile users.id validator (delete body). Not a Storage owner id. */
export function isValidMemberUserId(userId: string): boolean {
  return isValidUuid(userId);
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
 * Only profile userId + pathField (DB column name) are accepted.
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
  if (
    segments.some(
      (segment) => segment === "" || segment === "." || segment === "..",
    )
  ) {
    return { ok: false, error: "Invalid document path." };
  }

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
 * Require first path segment === target user's auth_user_id (Auth UID).
 * Opaque paths and profile-id prefixes are rejected.
 * Never treats users.id as the Storage owner.
 */
export function assertIdentityStoragePathOwnedByAuthUid(
  storagePath: string,
  authUserId: string,
): StoragePathValidation {
  const authUid = authUserId.trim();
  if (!authUid || !isValidUuid(authUid)) {
    return {
      ok: false,
      error: "User Auth UID is unavailable or invalid.",
    };
  }

  const first = storagePath.split("/")[0] ?? "";
  if (!isValidUuid(first)) {
    return {
      ok: false,
      error: "Document path is missing Auth UID ownership prefix.",
    };
  }
  if (first.toLowerCase() !== authUid.toLowerCase()) {
    return {
      ok: false,
      error: "Document path does not belong to this user.",
    };
  }
  return { ok: true, path: storagePath };
}

/**
 * Gate for Admin signed-URL generation. Never signs unverified paths.
 */
export function ownedIdentityPathForSigning(
  storagePath: string | null | undefined,
  authUserId: string | null | undefined,
): StoragePathValidation {
  if (typeof storagePath !== "string" || !storagePath.trim()) {
    return { ok: false, error: "Document path not found." };
  }
  if (typeof authUserId !== "string" || !authUserId.trim()) {
    return {
      ok: false,
      error: "User Auth UID is unavailable or invalid.",
    };
  }

  const pathCheck = validateIdentityStorageObjectPath(storagePath);
  if (!pathCheck.ok) return pathCheck;

  return assertIdentityStoragePathOwnedByAuthUid(pathCheck.path, authUserId);
}

/** @deprecated Use assertIdentityStoragePathOwnedByAuthUid — kept name alias for clarity in diffs. */
export function assertStoragePathConsistentWithUser(
  storagePath: string,
  authUserId: string,
): StoragePathValidation {
  return assertIdentityStoragePathOwnedByAuthUid(storagePath, authUserId);
}

export type ResolvedIdentityDeleteTarget =
  | {
      ok: true;
      userId: string;
      authUserId: string;
      pathField: IdentityPathField;
      storagePath: string;
      legacyFlag: string | null;
    }
  | { ok: false; status: number; error: string };

/**
 * Resolve delete target from the member's DB row, then prove Storage ownership
 * via auth_user_id (not profile users.id).
 */
export function resolveIdentityDocumentDeleteTarget(input: {
  userId: string;
  authUserId: string | null | undefined;
  pathField: IdentityPathField;
  row: Record<string, unknown> | null;
}): ResolvedIdentityDeleteTarget {
  const { userId, pathField, row } = input;
  const authUserId =
    typeof input.authUserId === "string" ? input.authUserId.trim() : "";

  if (!authUserId || !isValidUuid(authUserId)) {
    return {
      ok: false,
      status: 400,
      error: "User Auth UID is unavailable or invalid.",
    };
  }

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

  const bindCheck = assertIdentityStoragePathOwnedByAuthUid(
    pathCheck.path,
    authUserId,
  );
  if (!bindCheck.ok) {
    return { ok: false, status: 400, error: bindCheck.error };
  }

  return {
    ok: true,
    userId,
    authUserId,
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

/** Safe audit metadata — never includes signed URLs or secrets. */
export function buildIdentityDocumentDeleteAuditMetadata(input: {
  pathField: IdentityPathField;
  storagePath: string;
  bucket: string;
}): Record<string, unknown> {
  const segments = input.storagePath.split("/");
  return {
    pathField: input.pathField,
    bucket: input.bucket,
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
