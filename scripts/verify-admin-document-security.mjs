/**
 * Admin identity-document Auth-UID ownership checks (A7).
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

const PROFILE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROFILE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const AUTH_A = "11111111-1111-4111-8111-111111111111";
const AUTH_B = "22222222-2222-4222-8222-222222222222";
const FIELD = "driving_license_front_path";
const PATH_AUTH_A = `${AUTH_A}/dl_front-1710000000.jpg`;
const PATH_AUTH_B = `${AUTH_B}/dl_front-1710000000.jpg`;
const PATH_PROFILE_AS_OWNER = `${PROFILE_A}/dl_front-1710000000.jpg`;

function makeActor({ permissions = [], isSuperAdmin = false } = {}) {
  return {
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    username: "tester",
    displayName: "Tester",
    isSuperAdmin,
    isActive: true,
    permissions: new Set(permissions),
    isEnvBootstrap: false,
  };
}

function readSource(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

// --- 1) Correct Auth UID path accepted ---
{
  const owned = docs.ownedIdentityPathForSigning(PATH_AUTH_A, AUTH_A);
  assert.equal(owned.ok, true);
  assert.equal(owned.path, PATH_AUTH_A);

  const resolved = docs.resolveIdentityDocumentDeleteTarget({
    userId: PROFILE_A,
    authUserId: AUTH_A,
    pathField: FIELD,
    row: { [FIELD]: PATH_AUTH_A },
  });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.storagePath, PATH_AUTH_A);
  assert.equal(resolved.authUserId, AUTH_A);
  assert.equal(resolved.userId, PROFILE_A);
}

// --- 2) Different user's Auth UID path rejected ---
{
  const owned = docs.ownedIdentityPathForSigning(PATH_AUTH_B, AUTH_A);
  assert.equal(owned.ok, false);
  assert.match(owned.error, /does not belong/i);

  const resolved = docs.resolveIdentityDocumentDeleteTarget({
    userId: PROFILE_A,
    authUserId: AUTH_A,
    pathField: FIELD,
    row: { [FIELD]: PATH_AUTH_B },
  });
  assert.equal(resolved.ok, false);
}

// --- 3) Profile users.id is NOT treated as Storage owner ---
{
  // Path folder == profile id, auth uid different → reject
  const owned = docs.ownedIdentityPathForSigning(PATH_PROFILE_AS_OWNER, AUTH_A);
  assert.equal(owned.ok, false);

  // Passing profile id where auth uid is required must not accept that path
  const asAuthMistake = docs.ownedIdentityPathForSigning(
    PATH_PROFILE_AS_OWNER,
    PROFILE_A,
  );
  // Even if someone passes profile id as "authUserId", that only matches if
  // the path was wrongly written with profile id — product rule is Auth UID.
  // Test asserts helper never equates PROFILE to AUTH for PATH_AUTH_A:
  const wrongOwnerArg = docs.ownedIdentityPathForSigning(PATH_AUTH_A, PROFILE_A);
  assert.equal(wrongOwnerArg.ok, false);

  // Document that PROFILE_A !== AUTH_A
  assert.notEqual(PROFILE_A, AUTH_A);
  void asAuthMistake;
}

// --- 4) Opaque path rejected ---
{
  assert.equal(
    docs.ownedIdentityPathForSigning("uploads/dl-front.jpg", AUTH_A).ok,
    false,
  );
  assert.equal(
    docs.resolveIdentityDocumentDeleteTarget({
      userId: PROFILE_A,
      authUserId: AUTH_A,
      pathField: FIELD,
      row: { [FIELD]: "uploads/dl-front.jpg" },
    }).ok,
    false,
  );
  assert.match(
    docs.assertIdentityStoragePathOwnedByAuthUid("bare-file.jpg", AUTH_A)
      .error,
    /Auth UID ownership prefix/i,
  );
}

// --- 5) Malformed path rejected ---
{
  assert.equal(
    docs.validateIdentityStorageObjectPath("../etc/passwd").ok,
    false,
  );
  assert.equal(
    docs.validateIdentityStorageObjectPath("https://evil.example/x").ok,
    false,
  );
  assert.equal(
    docs.ownedIdentityPathForSigning(`${AUTH_A}/../../x`, AUTH_A).ok,
    false,
  );
  assert.equal(
    docs.validateIdentityStorageObjectPath("identity-documents/foo.jpg").ok,
    false,
  );
}

// --- 6 & 7) Verification + user detail pages do not sign foreign/unverified paths ---
{
  const verification = readSource(
    "app/dashboard/verification/[userId]/page.tsx",
  );
  const userDetail = readSource("app/dashboard/users/[id]/page.tsx");
  for (const src of [verification, userDetail]) {
    assert.match(src, /ownedIdentityPathForSigning/);
    assert.match(src, /fetchAuthUserId/);
    assert.match(src, /auth_user_id/);
    assert.match(src, /createOwnedSignedUrl/);
    // Must not call createSignedUrl on raw path without ownership gate
    assert.equal(
      /createSignedUrl\(doc\.path\)/.test(src),
      false,
    );
    assert.match(src, /owned\.ok/);
  }
}

// --- 8) Delete rejects foreign paths + loads auth_user_id ---
{
  const route = readSource("app/api/admin/delete-document/route.ts");
  assert.match(route, /auth_user_id/);
  assert.match(route, /authUserId/);
  assert.match(route, /resolveIdentityDocumentDeleteTarget/);
  assert.match(route, /actorCanMutateIdentityDocuments/);

  const foreign = docs.resolveIdentityDocumentDeleteTarget({
    userId: PROFILE_A,
    authUserId: AUTH_A,
    pathField: FIELD,
    row: { [FIELD]: PATH_AUTH_B },
  });
  assert.equal(foreign.ok, false);

  const missingAuth = docs.resolveIdentityDocumentDeleteTarget({
    userId: PROFILE_A,
    authUserId: null,
    pathField: FIELD,
    row: { [FIELD]: PATH_AUTH_A },
  });
  assert.equal(missingAuth.ok, false);
  assert.match(missingAuth.error, /Auth UID/i);
}

// --- 9) Admin RBAC checks remain enforced ---
{
  assert.equal(
    docs.actorCanMutateIdentityDocuments(
      makeActor({ permissions: ["members.view"] }),
    ),
    false,
  );
  assert.equal(
    docs.actorCanMutateIdentityDocuments(
      makeActor({ permissions: ["members.edit"] }),
    ),
    true,
  );
  assert.equal(
    docs.actorCanMutateIdentityDocuments(makeActor({ isSuperAdmin: true })),
    true,
  );
  const route = readSource("app/api/admin/delete-document/route.ts");
  assert.match(route, /requireAdminApi/);
  assert.match(route, /status: 403/);
  assert.match(route, /permission_denied/);
}

// --- 10) Valid Auth-UID workflow remains compatible ---
{
  const resolved = docs.resolveIdentityDocumentDeleteTarget({
    userId: PROFILE_A,
    authUserId: AUTH_A,
    pathField: FIELD,
    row: { [FIELD]: PATH_AUTH_A },
  });
  assert.equal(resolved.ok, true);
  assert.equal(
    docs.ownedIdentityPathForSigning(PATH_AUTH_A, AUTH_A).ok,
    true,
  );
  const payload = docs.buildIdentityDocumentClearPayload(FIELD, null);
  assert.deepEqual(payload, { [FIELD]: null });
  assert.equal(docs.IDENTITY_DOCUMENTS_BUCKET, "identity-documents");
  assert.ok(docs.LEGACY_IDENTITY_DOCUMENT_RECOVERY);
  assert.ok(Array.isArray(docs.KNOWN_IDENTITY_PATH_FORMATS));
}

// Client cannot supply storage path / bucket
{
  assert.equal(
    docs.parseIdentityDocumentDeleteBody({
      userId: PROFILE_A,
      pathField: FIELD,
      path: PATH_AUTH_B,
    }).ok,
    false,
  );
}

// Audit metadata stays safe
{
  const meta = docs.buildIdentityDocumentDeleteAuditMetadata({
    pathField: FIELD,
    storagePath: PATH_AUTH_A,
    bucket: docs.IDENTITY_DOCUMENTS_BUCKET,
  });
  assert.equal(docs.auditPayloadLooksSafe(meta), true);
  assert.equal(meta.objectKeySuffix, "dl_front-1710000000.jpg");
}

console.log("verify-admin-document-security: OK");
console.log(
  "Note: live Supabase sign/delete not executed. Legacy opaque paths fail closed — manual recovery documented in lib/admin-identity-documents.ts.",
);
