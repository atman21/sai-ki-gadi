/**
 * A13 hardening regression suite.
 *
 * Test kinds in this file:
 * - UNIT: pure helpers (UUID, fraud SSR gate, safeErrorMessage)
 * - STATIC: source contracts for SSR gate, audit denial, error sanitization
 * - HTTP: not executed here (no live admin session / no production calls)
 *
 * Run: npm run test:admin-rbac-a13-hardening
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

function loadTsModule(rel, rewriteImports = {}) {
  let source = read(rel);
  for (const [from, to] of Object.entries(rewriteImports)) {
    source = source.replaceAll(from, to);
  }
  // Strip remaining path-alias imports that are unused after rewrite.
  source = source.replace(
    /^import\s+[\s\S]*?\s+from\s+["']@\/[^"']+["'];?\s*$/gm,
    "",
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    reportDiagnostics: true,
  });
  assert.equal(
    (compiled.diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error)
      .length,
    0,
    `transpile errors in ${rel}`,
  );
  const mod = { exports: {} };
  const run = new Function("exports", "module", "require", compiled.outputText);
  run(mod.exports, mod, (id) => {
    if (rewriteImports[id]) return rewriteImports[id];
    throw new Error(`Unexpected require(${id}) while loading ${rel}`);
  });
  return mod.exports;
}

// --- UNIT: isAdminUuid ---
{
  const { isAdminUuid } = loadTsModule("lib/admin-uuid.ts");
  assert.equal(isAdminUuid("11111111-2222-3333-4444-555555555555"), true);
  assert.equal(isAdminUuid("not-a-uuid"), false);
  assert.equal(isAdminUuid("11111111-2222-3333-4444-55555555555"), false);
  assert.equal(isAdminUuid("11111111-2222-3333-4444-5555555555555"), false);
  assert.equal(isAdminUuid(""), false);
  console.log("UNIT isAdminUuid: OK");
}

// --- UNIT: actorCanViewFraudReports ---
{
  const rbac = {
    actorHasPermission(actor, permission) {
      if (actor.isSuperAdmin) return true;
      return actor.permissions.has(permission);
    },
  };
  // Inject mock by rewriting the import to a local binding via preamble.
  const source = `
const { actorHasPermission } = require("rbac-mock");
${read("lib/dashboard-fraud-ssr.ts").replace(
  /import[\s\S]*?from\s+["']@\/lib\/admin-rbac["'];?\s*/,
  "",
).replace(/import type[\s\S]*?;\s*/, "")}
module.exports = { actorCanViewFraudReports };
`;
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  });
  const mod = { exports: {} };
  const run = new Function("exports", "module", "require", compiled.outputText);
  run(mod.exports, mod, (id) => {
    if (id === "rbac-mock") return rbac;
    throw new Error(id);
  });
  const { actorCanViewFraudReports } = mod.exports;

  assert.equal(actorCanViewFraudReports(null), false);
  assert.equal(actorCanViewFraudReports(undefined), false);
  assert.equal(
    actorCanViewFraudReports({
      isActive: false,
      isSuperAdmin: true,
      permissions: new Set(),
    }),
    false,
  );
  assert.equal(
    actorCanViewFraudReports({
      isActive: true,
      isSuperAdmin: false,
      permissions: new Set(),
    }),
    false,
  );
  assert.equal(
    actorCanViewFraudReports({
      isActive: true,
      isSuperAdmin: false,
      permissions: new Set(["fraud.view"]),
    }),
    true,
  );
  assert.equal(
    actorCanViewFraudReports({
      isActive: true,
      isSuperAdmin: true,
      permissions: new Set(),
    }),
    true,
  );

  // Props selection must not pass through rows without permission.
  const rows = [{ id: "fraud-1", reason: "secret" }];
  const canView = actorCanViewFraudReports({
    isActive: true,
    isSuperAdmin: false,
    permissions: new Set(["members.view"]),
  });
  const fraudReportsProp = canView ? rows : [];
  assert.deepEqual(fraudReportsProp, []);
  assert.equal(
    JSON.stringify(fraudReportsProp).includes("secret"),
    false,
  );
  console.log("UNIT actorCanViewFraudReports / SSR props: OK");
}

// --- UNIT: safeErrorMessage never leaks raw DB text ---
{
  const apiSrc = read("lib/admin-api.ts");
  assert.match(
    apiSrc,
    /export function safeErrorMessage\(_error: unknown, fallback: string\): string \{\s*return fallback;\s*\}/,
  );
  // Evaluate the hardened contract directly.
  function safeErrorMessage(_error, fallback) {
    return fallback;
  }
  assert.equal(
    safeErrorMessage(
      { message: 'duplicate key value violates unique constraint "route_minimum_fares_pkey"' },
      "Unable to create minimum fare.",
    ),
    "Unable to create minimum fare.",
  );
  assert.equal(
    safeErrorMessage({ message: "JWT expired" }, "Unable to load."),
    "Unable to load.",
  );
  console.log("UNIT safeErrorMessage: OK");
}

// --- STATIC: dashboard SSR fraud.view gate ---
{
  const page = read("app/dashboard/page.tsx");
  assert.match(page, /actorCanViewFraudReports/);
  assert.match(page, /canViewFraud/);
  assert.match(page, /canViewFraud\s*\?/);
  assert.match(page, /fraudReports = canViewFraud \? fraudReportsResult\.data : \[\]/);
  assert.match(page, /getAdminSessionPayload/);
  assert.match(page, /resolveActorFromSession/);
  // Must not unconditionally query fraud_reports at module level without gate.
  assert.match(page, /Do not query fraud_reports unless/);
  console.log("STATIC dashboard fraud SSR gate: OK");
}

// --- STATIC: member PUT permission_denied audit ---
{
  const users = read("app/api/admin/users/[id]/route.ts");
  assert.match(users, /permissionDeniedResponse\([\s\S]*members\.edit/);
  assert.match(users, /permissionDeniedResponse\([\s\S]*members\.membership/);
  const api = read("lib/admin-api.ts");
  assert.match(api, /action:\s*"permission_denied"/);
  assert.match(api, /export function permissionDeniedResponse/);
  // Single shared helper used by requireAdminPermission (no duplicate audit paths).
  assert.match(api, /permissionDeniedResponse\(gate\.actor, permission, opts\)/);
  console.log("STATIC member PUT permission_denied audit: OK");
}

// --- STATIC: birth-date strict UUID ---
{
  const birth = read("app/api/admin/users/[id]/birth-date/route.ts");
  assert.match(birth, /isAdminUuid\(id\)/);
  assert.doesNotMatch(birth, /\[a-f0-9-\]\{27,\}/);
  console.log("STATIC birth-date UUID: OK");
}

// --- STATIC: A13 routes do not return raw error.message to clients ---
{
  const routes = [
    "app/api/admin/minimum-fares/route.ts",
    "app/api/admin/minimum-fares/[id]/route.ts",
    "app/api/admin/notifications/route.ts",
    "app/api/admin/birthday-notification-status/route.ts",
    "app/api/admin/birthday-notification-settings/route.ts",
    "app/api/admin/lucky-draw-notification-settings/route.ts",
    "app/api/admin/user-fare-overrides/route.ts",
    "app/api/admin/fare-override-requests/route.ts",
    "app/api/admin/fare-override-requests/[id]/route.ts",
    "app/api/admin/fare-override-requests/approve/route.ts",
    "app/api/admin/fare-override-requests/reject/route.ts",
  ];
  for (const rel of routes) {
    const src = read(rel);
    assert.doesNotMatch(
      src,
      /error:\s*error\.message/,
      `${rel} must not return error.message to clients`,
    );
    assert.doesNotMatch(
      src,
      /error:\s*settingsRes\.error\.message/,
      `${rel} must not return settingsRes.error.message`,
    );
  }
  // Expected validation paths remain explicit (not swallowed as generic DB errors).
  assert.match(
    read("app/api/admin/minimum-fares/route.ts"),
    /A rule already exists for this From City/,
  );
  console.log("STATIC safe client errors on A13 routes: OK");
}

// --- STATIC: notification limitation (no invented permission) ---
{
  const perms = read("lib/admin-permissions.ts");
  assert.doesNotMatch(perms, /"notifications\./);
  const notif = read("app/api/admin/notifications/route.ts");
  assert.match(notif, /requireAdminApi/);
  assert.doesNotMatch(notif, /requireAdminPermission/);
  console.log("STATIC notification catalog limitation: OK");
}

console.log("verify-admin-rbac-a13-hardening: OK");
console.log(
  "NOTE: HTTP runtime 401/403/authorized matrix was NOT executed (no staging session).",
);
