/**
 * A25-FIX-02 Admin security hardening — static regression checks.
 * Does not call live HTTP, TTS, or the database.
 *
 * Run: npm run test:a25-fix02-admin-security
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

{
  const tts = read("app/api/tts/route.ts");
  assert.match(
    tts,
    /requireAdminPermission\(\s*["']announcements\.manage["']/,
    "TTS must require announcements.manage",
  );
  assert.match(tts, /if\s*\(\s*!gate\.ok\s*\)\s*return\s+gate\.response/);
  assert.match(tts, /safeErrorMessage/);
  assert.doesNotMatch(
    tts,
    /return NextResponse\.json\(\s*\{\s*success:\s*false,\s*error:\s*String\(e\)/,
  );
  console.log("STATIC TTS announcements.manage gate: OK");
}

{
  const create = read("app/api/admin/panel-users/route.ts");
  const patch = read("app/api/admin/panel-users/[id]/route.ts");

  assert.match(create, /requireAdminPermission\(\s*["']admins\.manage["']/);
  assert.match(
    create,
    /if\s*\(\s*roleIds\.length\s*>\s*0\s*\)\s*\{[\s\S]*?permissions\.assign/,
    "CREATE with roleIds must check permissions.assign",
  );
  assert.match(
    create,
    /Forbidden — cannot assign roles/,
    "CREATE role denial message must match PATCH",
  );

  assert.match(
    patch,
    /permissions\.assign/,
    "PATCH must still gate role assignment",
  );
  console.log("STATIC panel-users role assignment parity: OK");
}

{
  const panel = read("components/admin/admin-users-panel.tsx");
  assert.match(panel, /permissions\.assign/);
  assert.match(panel, /roleIds:/);
  console.log("STATIC admin-users panel roleIds gating: OK");
}

console.log("verify-a25-fix02-admin-security: OK");
console.log(
  "NOTE: Live HTTP 401/403 TTS/panel-user matrix was NOT executed.",
);
