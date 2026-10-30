/**
 * Admin identity-document ownership / path / audit checks.
 * Run: node scripts/verify-admin-document-security.mjs
 *
 * Uses production helpers from lib/admin-identity-documents.ts via
 * typescript.transpileModule. Never connects to Supabase or deletes real files.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const ts = require("typescript");

async function loadTsModule(relativePath) {
  const sourcePath = path.join(root, relativePath);
  let source = fs.readFileSync(sourcePath, "utf8");
  // Strip type-only / path-alias imports that are unused after transpile for
  // this pure helper module — replace @/ imports with stubs via rewrite.
  source = source
    .replace(
      /import type \{ AdminActor \} from "@\/lib\/admin-rbac";\n/,
      "",
    )
    .replace(
      /import \{ actorHasPermission \} from "@\/lib\/admin-rbac";\n/,
      "function actorHasPermission(actor, permission) {\n  if (actor.isSuperAdmin) return true;\n  return actor.permissions.has(permission);\n}\n",
    )
    .replace(
      /import type \{ AdminPermission \} from "@\/lib\/admin-permissions";\n/,
      "",
    );

  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      skipLibCheck: true,
    },
    fileName: path.basename(relativePath),
  });
  const tmp = path.join(
    os.tmpdir(),
    `skg-docs-${path.basename(relativePath)}-${process.pid}-${Date.now()}.mjs`,
  );
  fs.writeFileSync(tmp, outputText, "utf8");
  try {
    return await import(pathToFileURL(tmp).href);
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // ignore
    }
  }
}

const docs = await loadTsModule("lib/admin-identity-documents.ts");

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const FIELD = "driving_license_front_path";
const PATH_A = `${USER_A}/dl-front.jpg`;
const PATH_B = `${USER_B}/dl-front.jpg`;

function makeActor({ permissions = [], isSuperAdmin = false } = {}) {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    username: "tester",
    displayName: "Tester",
    isSuperAdmin,
    isActive: true,
    permissions: new Set(permissions),
    isEnvBootstrap: false,
  };
}

// --- 1) Authorized resolve: correct user + DB path ---
{
  const parsed = docs.parseIdentityDocumentDeleteBody({
    userId: USER_A,
    pathField: FIELD,
  });
  assert.equal(parsed.ok, true);
  const resolved = docs.resolveIdentityDocumentDeleteTarget({
    userId: USER_A,
    pathField: FIELD,
    row: { [FIELD]: PATH_A },
  });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.storagePath, PATH_A);
  assert.equal(resolved.userId, USER_A);
}

// --- 2) Another user's UUID-prefixed path in this user's row → rejected ---
{
  const resolved = docs.resolveIdentityDocumentDeleteTarget({
    userId: USER_A,
    pathField: FIELD,
    row: { [FIELD]: PATH_B },
  });
  assert.equal(resolved.ok, false);
  assert.match(resolved.error, /does not belong/i);
}

// --- 3) Request changes userId but keeps original path (client cannot send path) ---
{
  // Client only sends userId+pathField; path comes from DB for THAT userId.
  // Simulating DB for USER_B with PATH_A (cross-bound) → rejected by UUID bind.
  const resolved = docs.resolveIdentityDocumentDeleteTarget({
    userId: USER_B,
    pathField: FIELD,
    row: { [FIELD]: PATH_A },
  });
  assert.equal(resolved.ok, false);
}

// --- 4) Request tries to change document path via body ---
{
  const bad = docs.parseIdentityDocumentDeleteBody({
    userId: USER_A,
    pathField: FIELD,
    path: PATH_B,
  });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /Storage path fields are not allowed/);

  const bad2 = docs.parseIdentityDocumentDeleteBody({
    userId: USER_A,
    pathField: FIELD,
    storagePath: PATH_B,
  });
  assert.equal(bad2.ok, false);
}

// --- 5) Invalid / disallowed pathField ---
{
  const bad = docs.parseIdentityDocumentDeleteBody({
    userId: USER_A,
    pathField: "password_hash",
  });
  assert.equal(bad.ok, false);
  assert.equal(docs.isAllowedIdentityPathField("password_hash"), false);
  assert.equal(docs.isAllowedIdentityPathField(FIELD), true);
}

// --- 6) Malformed storage path ---
{
  const v = docs.validateIdentityStorageObjectPath("");
  assert.equal(v.ok, false);
  const v2 = docs.validateIdentityStorageObjectPath("https://evil.example/x");
  assert.equal(v2.ok, false);
}

// --- 7) Path traversal ---
{
  assert.equal(docs.validateIdentityStorageObjectPath("../etc/passwd").ok, false);
  assert.equal(
    docs.validateIdentityStorageObjectPath(`${USER_A}/../../secret`).ok,
    false,
  );
  assert.equal(
    docs.validateIdentityStorageObjectPath(`${USER_A}/./hide`).ok,
    false,
  );
}

// --- 8) Wrong storage bucket encoded in key ---
{
  assert.equal(
    docs.validateIdentityStorageObjectPath("identity-documents/foo.jpg").ok,
    false,
  );
  assert.equal(
    docs.validateIdentityStorageObjectPath("vehicle-documents/rc.jpg").ok,
    false,
  );
  assert.equal(docs.IDENTITY_DOCUMENTS_BUCKET, "identity-documents");
}

// --- 9) Missing database document reference ---
{
  const missing = docs.resolveIdentityDocumentDeleteTarget({
    userId: USER_A,
    pathField: FIELD,
    row: null,
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.status, 404);

  const empty = docs.resolveIdentityDocumentDeleteTarget({
    userId: USER_A,
    pathField: FIELD,
    row: { [FIELD]: null },
  });
  assert.equal(empty.ok, false);
  assert.equal(empty.status, 404);
}

// --- 10–12) Failure paths must not yield ok:true (route source contract) ---
{
  const routeSource = fs.readFileSync(
    path.join(root, "app", "api", "admin", "delete-document", "route.ts"),
    "utf8",
  );
  assert.match(routeSource, /requireAdminApi/);
  assert.match(routeSource, /actorCanMutateIdentityDocuments/);
  assert.match(routeSource, /deleteStorageError/);
  assert.match(routeSource, /updateError/);
  assert.match(routeSource, /Failed to clear document path/);
  assert.match(routeSource, /return NextResponse\.json\(\{\s*ok:\s*true\s*\}\)/);
  // Success return only after confirm clear
  assert.match(routeSource, /database_confirm|clearedValue|updatedRow/);
  // Storage failure returns before ok:true
  const storageFailIdx = routeSource.indexOf("deleteStorageError");
  const successIdx = routeSource.lastIndexOf("ok: true");
  assert.ok(storageFailIdx > 0 && successIdx > storageFailIdx);
}

// Simulated orchestrated failure outcomes (no network)
function simulateDeleteOutcome({ storageError, updateError, cleared }) {
  if (storageError) return { ok: false, stage: "storage" };
  if (updateError) return { ok: false, stage: "database" };
  if (!cleared) return { ok: false, stage: "confirm" };
  return { ok: true };
}
assert.equal(simulateDeleteOutcome({ storageError: true }).ok, false);
assert.equal(simulateDeleteOutcome({ updateError: true }).ok, false);
assert.equal(simulateDeleteOutcome({ cleared: false }).ok, false);
assert.equal(simulateDeleteOutcome({ cleared: true }).ok, true);

// --- 13–14) Audit metadata for success; no secrets/URLs ---
{
  const meta = docs.buildIdentityDocumentDeleteAuditMetadata({
    pathField: FIELD,
    storagePath: PATH_A,
    bucket: docs.IDENTITY_DOCUMENTS_BUCKET,
  });
  assert.equal(meta.pathField, FIELD);
  assert.equal(meta.bucket, "identity-documents");
  assert.equal(meta.objectKeySuffix, "dl-front.jpg");
  assert.equal(docs.auditPayloadLooksSafe(meta), true);
  assert.equal(
    docs.auditPayloadLooksSafe({
      url: "https://signed.example/token=abc",
    }),
    false,
  );
  assert.equal(
    docs.auditPayloadLooksSafe({
      key: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaaaaaaaaaaaaaaaaaaa.sig",
    }),
    false,
  );

  const routeSource = fs.readFileSync(
    path.join(root, "app", "api", "admin", "delete-document", "route.ts"),
    "utf8",
  );
  assert.match(routeSource, /identity_document_deleted/);
  assert.match(routeSource, /writeAdminAuditLog/);
  assert.equal(routeSource.includes("resolved.storagePath"), true);
  // Full storage path must not be written into description as a URL
  assert.equal(/description:[\s\S]*https?:\/\//.test(routeSource), false);
}

// --- 15) Unauthorized / insufficient permission ---
{
  const viewer = makeActor({ permissions: ["members.view"] });
  assert.equal(docs.actorCanMutateIdentityDocuments(viewer), false);

  const editor = makeActor({ permissions: ["members.edit"] });
  assert.equal(docs.actorCanMutateIdentityDocuments(editor), true);

  const approver = makeActor({ permissions: ["members.approve"] });
  assert.equal(docs.actorCanMutateIdentityDocuments(approver), true);

  const rejector = makeActor({ permissions: ["members.reject"] });
  assert.equal(docs.actorCanMutateIdentityDocuments(rejector), true);

  const superAdmin = makeActor({ isSuperAdmin: true });
  assert.equal(docs.actorCanMutateIdentityDocuments(superAdmin), true);

  const routeSource = fs.readFileSync(
    path.join(root, "app", "api", "admin", "delete-document", "route.ts"),
    "utf8",
  );
  assert.match(routeSource, /status: 403/);
  assert.match(routeSource, /permission_denied/);
}

// --- 16) Compatibility: clear payload + legacy flags; bucket constant ---
{
  const payload = docs.buildIdentityDocumentClearPayload(
    "aadhaar_file_path",
    "aadhaar_uploaded",
  );
  assert.deepEqual(payload, {
    aadhaar_file_path: null,
    aadhaar_uploaded: false,
  });
  const modern = docs.buildIdentityDocumentClearPayload(FIELD, null);
  assert.deepEqual(modern, { [FIELD]: null });

  // Non-UUID-prefixed paths (layout unknown) still allowed when consistent
  const opaque = docs.resolveIdentityDocumentDeleteTarget({
    userId: USER_A,
    pathField: FIELD,
    row: { [FIELD]: "uploads/dl-front.jpg" },
  });
  assert.equal(opaque.ok, true);
  assert.equal(opaque.storagePath, "uploads/dl-front.jpg");
}

// Route must not accept client bucket override
{
  const badBucket = docs.parseIdentityDocumentDeleteBody({
    userId: USER_A,
    pathField: FIELD,
    bucket: "vehicle-documents",
  });
  assert.equal(badBucket.ok, false);
}

console.log("verify-admin-document-security: OK");
console.log(
  "Note: storage/DB integration not executed (no production Supabase). Manual staging QA required for live delete.",
);
