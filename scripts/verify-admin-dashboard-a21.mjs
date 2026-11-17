/**
 * A21 Admin dashboard performance + RBAC contracts (static + unit).
 * Run: npm run test:admin-dashboard-a21
 *
 * Does not prove live HTTP/DB against a running server.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

function assertUsesPermission(rel, permission) {
  const src = read(rel);
  assert.match(
    src,
    new RegExp(`requireAdminPermission\\(\\s*["']${permission.replace(".", "\\.")}["']`),
    `${rel} must require ${permission}`,
  );
  assert.match(
    src,
    /if\s*\(\s*!(?:gate|__adminGate|auth|adminGate)\.ok\s*\)\s*return\s*(?:gate|__adminGate|auth|adminGate)\.response/,
    `${rel} must return denied response`,
  );
}

// --- Preserve A13/A18/A19 ---
{
  assertUsesPermission(
    "app/api/admin/winners/route.ts",
    "winners.manage",
  );
  assertUsesPermission(
    "app/api/admin/users/[id]/wallet/route.ts",
    "members.wallet",
  );
  const wallet = read("app/api/admin/users/[id]/wallet/route.ts");
  assert.equal(
    [...wallet.matchAll(/requireAdminPermission\(\s*["']members\.wallet["']/g)]
      .length >= 2,
    true,
    "wallet GET+POST must both require members.wallet",
  );
  const page = read("app/dashboard/page.tsx");
  assert.match(page, /actorCanViewListingFares/);
  assert.match(page, /requirementSsrSelect\(canViewListingFares\)/);
  assert.doesNotMatch(
    page,
    /from\s+["']@\/lib\/dashboard-listing-fare-display["']/,
  );
  // A18 client boundary still intact
  const tabs = read("app/dashboard/dashboard-tabs.tsx");
  assert.match(tabs, /dashboard-listing-fare-display/);
  console.log("STATIC A13/A18/A19 preserved: OK");
}

// --- A21 RBAC gates ---
{
  assertUsesPermission("app/api/admin/cities/route.ts", "cities.manage");
  assertUsesPermission("app/api/admin/cities/[id]/route.ts", "cities.manage");
  assertUsesPermission("app/api/admin/sliders/route.ts", "sliders.manage");
  assertUsesPermission("app/api/admin/sliders/[id]/route.ts", "sliders.manage");
  assertUsesPermission(
    "app/api/admin/sliders/reorder/route.ts",
    "sliders.manage",
  );
  assertUsesPermission(
    "app/api/admin/priority-settings/route.ts",
    "priority.view",
  );
  assertUsesPermission(
    "app/api/admin/priority-settings/route.ts",
    "priority.manage",
  );
  assertUsesPermission("app/api/admin/about-us/route.ts", "about.view");
  assertUsesPermission("app/api/admin/about-us/route.ts", "about.manage");
  assertUsesPermission(
    "app/api/admin/users/[id]/membership-history/route.ts",
    "members.membership",
  );
  assertUsesPermission("app/api/admin/users/route.ts", "members.view");

  const search = read("app/api/admin/users/search/route.ts");
  assert.match(search, /members\.wallet/);
  assert.match(search, /members\.membership/);
  assert.match(search, /members\.view/);
  assert.match(search, /permissionDeniedResponse/);

  assertUsesPermission(
    "app/api/admin/in-app-announcements/route.ts",
    "announcements.view",
  );
  assertUsesPermission(
    "app/api/admin/in-app-announcements/route.ts",
    "announcements.manage",
  );
  assertUsesPermission(
    "app/api/admin/in-app-announcements/[id]/route.ts",
    "announcements.view",
  );
  assertUsesPermission(
    "app/api/admin/in-app-announcements/upload/route.ts",
    "announcements.manage",
  );

  console.log("STATIC A21 API RBAC gates: OK");
}

// --- SSR permission gating + explicit selects ---
{
  const page = read("app/dashboard/page.tsx");
  assert.match(page, /actorCanAccess/);
  for (const key of [
    "winners.view",
    "cities.view",
    "sliders.view",
    "priority.view",
    "lucky_draw.view",
    "birthday.view",
    "requirements.view",
    "exchanges.view",
    "profile_changes.view",
    "vehicles.view",
    "minimum_fares.view",
    "fare_overrides.view",
  ]) {
    assert.match(page, new RegExp(`["']${key.replace(".", "\\.")}["']`));
  }
  assert.doesNotMatch(
    page,
    /\.from\(["']cities["']\)\.select\(["']\*["']\)/,
  );
  assert.doesNotMatch(
    page,
    /\.from\(["']sliders["']\)\.select\(["']\*["']\)/,
  );
  assert.doesNotMatch(page, /\.from\(["']winners["']\)[\s\S]{0,80}\.select\(\s*`\s*\*/);
  console.log("STATIC SSR permission gating + selects: OK");
}

// --- Fare-stats duplicate fetch regression ---
{
  const tabs = read("app/dashboard/dashboard-tabs.tsx");
  // Mount-once refresh must not depend on activeTab
  assert.match(
    tabs,
    /fetch\(["']\/api\/admin\/fare-stats["']\)[\s\S]{0,400}\},\s*\[\s*\]\s*\)/,
  );
  assert.doesNotMatch(
    tabs,
    /fetch\(["']\/api\/admin\/fare-stats["']\)[\s\S]{0,400}\},\s*\[\s*activeTab\s*\]\s*\)/,
  );
  console.log("STATIC fare-stats mount-once: OK");
}

// --- SSR critical-path: actor overlaps wave 1; fare counts in wave 2 ---
{
  const page = read("app/dashboard/page.tsx");
  assert.match(
    page,
    /session \? resolveActorFromSession\(session\) : Promise\.resolve\(null\)/,
  );
  assert.match(page, /minimumFareRulesTotalResult/);
  assert.match(
    page,
    /minimumFareRules:\s*minimumFareRulesTotalResult\.error/,
  );
  // Third sequential fare-count wave should not remain after wave-2 merge.
  assert.doesNotMatch(
    page,
    /\/\/ Fare override tables may not exist until migration 052 is applied\.\s*const skippedCount/,
  );
  console.log("STATIC SSR actor overlap + fare count merge: OK");
}

// --- Remaining RBAC gaps closed ---
{
  assertUsesPermission(
    "app/api/admin/delete-document/route.ts",
    "members.edit",
  );
  const upload = read("app/api/admin/upload/route.ts");
  assert.match(upload, /sliders\.manage/);
  assert.match(upload, /winners\.manage/);
  assert.match(upload, /permissionDeniedResponse/);
  console.log("STATIC delete-document + upload RBAC: OK");
}

// --- Users tab pagination ---
{
  const tabs = read("app/dashboard/dashboard-tabs.tsx");
  assert.match(tabs, /USERS_PAGE_SIZE/);
  assert.match(tabs, /paginatedUsers/);
  assert.match(tabs, /setUsersPage/);
  console.log("STATIC users tab pagination: OK");
}

// --- Wallet panel client gate ---
{
  const panel = read("app/dashboard/components/admin-wallet-panel.tsx");
  assert.match(panel, /useAdminAccessOptional/);
  assert.match(panel, /members\.wallet/);
  assert.match(panel, /deniedWallet/);
  console.log("STATIC wallet panel UI gate: OK");
}

// --- UNIT actorCanAccess ---
{
  const rbac = {
    actorHasPermission(actor, permission) {
      if (actor.isSuperAdmin) return true;
      return actor.permissions.has(permission);
    },
  };
  const source = `
const { actorHasPermission } = require("rbac-mock");
${read("lib/dashboard-ssr-permissions.ts")
  .replace(/import[\s\S]*?from\s+["']@\/lib\/admin-permissions["'];?\s*/, "")
  .replace(/import[\s\S]*?from\s+["']@\/lib\/admin-rbac["'];?\s*/g, "")}
module.exports = { actorCanAccess };
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
  const { actorCanAccess } = mod.exports;
  assert.equal(actorCanAccess(null, "cities.view"), false);
  assert.equal(
    actorCanAccess(
      { isActive: true, isSuperAdmin: false, permissions: new Set() },
      "cities.view",
    ),
    false,
  );
  assert.equal(
    actorCanAccess(
      {
        isActive: true,
        isSuperAdmin: false,
        permissions: new Set(["cities.view"]),
      },
      "cities.view",
    ),
    true,
  );
  assert.equal(
    actorCanAccess(
      { isActive: true, isSuperAdmin: true, permissions: new Set() },
      "cities.manage",
    ),
    true,
  );
  console.log("UNIT actorCanAccess: OK");
}

console.log("verify-admin-dashboard-a21: OK");
console.log(
  "NOTE: Live HTTP/DB performance and authorization proofs were NOT executed.",
);
