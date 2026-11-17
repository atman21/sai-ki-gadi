/**
 * A13 Admin RBAC regression checks (source-level + helper contracts).
 * Run: npm run test:admin-rbac-a13
 *
 * Covers unauthorized/missing-permission gates, session upgrade paths,
 * invalid ID validation, and catalog key usage. Does not call live APIs.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function assertUsesPermission(rel, permission) {
  const src = read(rel);
  assert.match(
    src,
    new RegExp(`requireAdminPermission\\(\\s*["']${permission}["']`),
    `${rel} must require ${permission}`,
  );
  assert.match(
    src,
    /if\s*\(\s*!gate\.ok\s*\)\s*return\s*gate\.response|if\s*\(\s*!__adminGate\.ok\s*\)\s*return\s*__adminGate\.response|if\s*\(\s*!adminGate\.ok\s*\)\s*return\s*adminGate\.response/,
    `${rel} must return denied gate.response (403 from requireAdminPermission)`,
  );
  assert.doesNotMatch(src, /\bhasAdminSession\s*\(/);
}

{
  const api = read("lib/admin-api.ts");
  assert.match(api, /requireAdminPermission/);
  assert.match(api, /Forbidden — insufficient permissions\./);
  assert.match(api, /status:\s*403/);
  assert.match(api, /permission_denied/);
  assert.match(api, /requireAdminApi/);
}

// 1) Fare revoke / overrides / minimum fares
assertUsesPermission(
  "app/api/admin/user-fare-overrides/revoke/route.ts",
  "fare_overrides.manage",
);
{
  const revoke = read("app/api/admin/user-fare-overrides/revoke/route.ts");
  assert.match(revoke, /OVERRIDE_ID_RE/);
  assert.match(revoke, /safeErrorMessage/);
  assert.match(revoke, /status:\s*400/);
}
assertUsesPermission(
  "app/api/admin/user-fare-overrides/route.ts",
  "fare_overrides.view",
);
assertUsesPermission(
  "app/api/admin/fare-override-requests/route.ts",
  "fare_overrides.view",
);
assertUsesPermission(
  "app/api/admin/fare-override-requests/[id]/route.ts",
  "fare_overrides.view",
);
assertUsesPermission(
  "app/api/admin/fare-override-requests/approve/route.ts",
  "fare_overrides.manage",
);
assertUsesPermission(
  "app/api/admin/fare-override-requests/reject/route.ts",
  "fare_overrides.manage",
);
{
  const min = read("app/api/admin/minimum-fares/route.ts");
  assert.match(min, /requireAdminPermission\(\s*["']minimum_fares\.view["']/);
  assert.match(min, /requireAdminPermission\(\s*["']minimum_fares\.manage["']/);
}
assertUsesPermission(
  "app/api/admin/minimum-fares/[id]/route.ts",
  "minimum_fares.manage",
);
assertUsesPermission(
  "app/api/admin/fare-stats/route.ts",
  "minimum_fares.view",
);

// 2) Fraud
assertUsesPermission("app/api/admin/fraud-reports/route.ts", "fraud.manage");
assertUsesPermission(
  "app/api/admin/fraud-reports/[id]/route.ts",
  "fraud.manage",
);
{
  const input = read("lib/fraud-report-input.ts");
  assert.match(input, /parseFraudReportCreateInput/);
  assert.match(input, /isFraudReportUuid/);
  const create = read("app/api/admin/fraud-reports/route.ts");
  assert.match(create, /Unable to create fraud report/);
  assert.doesNotMatch(create, /error:\s*error\.message/);
  const item = read("app/api/admin/fraud-reports/[id]/route.ts");
  assert.match(item, /isFraudReportUuid\(id\)/);
  assert.doesNotMatch(item, /error:\s*error\.message/);
  const ui = read("app/dashboard/dashboard-tabs.tsx");
  assert.match(ui, /adminAccess\.can\("fraud\.manage"\)/);
  assert.match(ui, /canManageFraud/);
}

// 3) Members
{
  const users = read("app/api/admin/users/[id]/route.ts");
  assert.match(users, /requireAdminPermission\(\s*["']members\.edit["']/);
  assert.match(users, /actorHasPermission\([^,]+,\s*["']members\.edit["']/);
  assert.match(
    users,
    /actorHasPermission\([^,]+,\s*["']members\.membership["']/,
  );
  assert.match(users, /isAdminUuid\(id\)/);
  assert.match(users, /permissionDeniedResponse\(/);
  assert.match(users, /Failed to delete member/);
  assert.match(users, /safeErrorMessage/);
  assert.doesNotMatch(users, /error:\s*error\.message/);
}
{
  const birth = read("app/api/admin/users/[id]/birth-date/route.ts");
  assert.match(birth, /requireAdminPermission\(\s*["']members\.edit["']/);
  assert.match(birth, /isAdminUuid\(id\)/);
  assert.doesNotMatch(birth, /\[a-f0-9-\]\{27,\}/);
}

// 4) Notifications — no notifications.* catalog key; require authenticated admin
{
  const src = read("app/api/admin/notifications/route.ts");
  assert.match(src, /requireAdminApi/);
  assert.doesNotMatch(src, /\bhasAdminSession\s*\(/);
  assert.match(src, /safeErrorMessage/);
  assert.doesNotMatch(src, /error:\s*error\.message/);
}

// 5) Lucky draw / birthday
{
  const ld = read("app/api/admin/lucky-draw-notification-settings/route.ts");
  assert.match(ld, /lucky_draw\.view/);
  assert.match(ld, /lucky_draw\.manage/);
}
assertUsesPermission(
  "app/api/admin/lucky-draw-notification-test/route.ts",
  "lucky_draw.manage",
);
{
  const bd = read("app/api/admin/birthday-notification-settings/route.ts");
  assert.match(bd, /birthday\.view/);
  assert.match(bd, /birthday\.manage/);
}
assertUsesPermission(
  "app/api/admin/birthday-notification-test/route.ts",
  "birthday.manage",
);
assertUsesPermission(
  "app/api/admin/birthday-notification-status/route.ts",
  "birthday.view",
);

// 6) Membership expiry
assertUsesPermission(
  "app/api/admin/memberships/expire/route.ts",
  "members.membership",
);

// Catalog keys exist (no invented permissions)
{
  const perms = read("lib/admin-permissions.ts");
  for (const key of [
    "fare_overrides.manage",
    "fare_overrides.view",
    "minimum_fares.manage",
    "minimum_fares.view",
    "fraud.manage",
    "members.edit",
    "members.membership",
    "lucky_draw.manage",
    "lucky_draw.view",
    "birthday.manage",
    "birthday.view",
  ]) {
    assert.match(perms, new RegExp(`"${key.replace(".", "\\.")}"`));
  }
  assert.doesNotMatch(perms, /"notifications\./);
}

// Client-supplied role/permission must not authorize these routes
for (const rel of [
  "app/api/admin/user-fare-overrides/revoke/route.ts",
  "app/api/admin/fraud-reports/route.ts",
  "app/api/admin/users/[id]/route.ts",
]) {
  const src = read(rel);
  assert.equal(/body\.(role|permission|isSuperAdmin)/.test(src), false);
}

console.log("verify-admin-rbac-a13: OK");
