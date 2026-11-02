/**
 * A18 Admin listing fare visibility contracts (static + unit).
 * Run: npm run test:admin-listing-fare-a18
 *
 * Does not prove live HTTP/SSR against a running server.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

function loadTs(rel, requireMap = {}) {
  const compiled = ts.transpileModule(read(rel), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  });
  const mod = { exports: {} };
  const run = new Function("exports", "module", "require", compiled.outputText);
  run(mod.exports, mod, (id) => {
    if (requireMap[id]) return requireMap[id];
    if (id.startsWith("@/")) {
      const mapped = id.replace("@/", "") + ".ts";
      return loadTs(mapped, requireMap);
    }
    throw new Error(`Unexpected require ${id} from ${rel}`);
  });
  return mod.exports;
}

// --- Catalog registration ---
{
  const perms = read("lib/admin-permissions.ts");
  assert.match(perms, /"listings\.fare_view"/);
  assert.match(
    perms,
    /permissions:\s*\[[\s\S]*"requirements\.view"[\s\S]*"exchanges\.view"[\s\S]*"listings\.fare_view"/,
  );
  // Listing view keys must not imply fare_view by aliasing.
  assert.doesNotMatch(perms, /requirements\.view.*=.*"listings\.fare_view"/);
  console.log("STATIC permission catalog: OK");
}

// --- Separation: other keys do not equal listings.fare_view ---
{
  const perms = read("lib/admin-permissions.ts");
  for (const key of [
    "requirements.view",
    "exchanges.view",
    "minimum_fares.view",
    "fare_overrides.view",
  ]) {
    assert.match(perms, new RegExp(`"${key.replace(".", "\\.")}"`));
    assert.notEqual(key, "listings.fare_view");
  }
  console.log("STATIC view keys remain distinct: OK");
}

// --- Super Admin architecture uses ADMIN_PERMISSIONS set ---
{
  const rbac = read("lib/admin-rbac.ts");
  assert.match(rbac, /allPermissionsSet\(\)/);
  assert.match(rbac, /new Set\(ADMIN_PERMISSIONS\)/);
  const me = read("app/api/admin/me/route.ts");
  assert.match(me, /isSuperAdmin[\s\S]*ADMIN_PERMISSIONS/);
  console.log("STATIC Super Admin receives catalog keys: OK");
}

// --- UNIT helpers ---
{
  const rbacMock = {
    actorHasPermission(actor, permission) {
      if (actor.isSuperAdmin) return true;
      return actor.permissions.has(permission);
    },
  };
  const helpers = loadTs("lib/dashboard-listing-fare.ts", {
    "@/lib/admin-rbac": rbacMock,
  });

  assert.equal(helpers.HIDDEN_LISTING_FARE_DISPLAY, "***");
  assert.equal(helpers.actorCanViewListingFares(null), false);
  assert.equal(
    helpers.actorCanViewListingFares({
      isActive: true,
      isSuperAdmin: false,
      permissions: new Set(["requirements.view", "exchanges.view"]),
    }),
    false,
  );
  assert.equal(
    helpers.actorCanViewListingFares({
      isActive: true,
      isSuperAdmin: false,
      permissions: new Set(["minimum_fares.view", "fare_overrides.view"]),
    }),
    false,
  );
  assert.equal(
    helpers.actorCanViewListingFares({
      isActive: true,
      isSuperAdmin: false,
      permissions: new Set(["listings.fare_view"]),
    }),
    true,
  );
  assert.equal(
    helpers.actorCanViewListingFares({
      isActive: true,
      isSuperAdmin: true,
      permissions: new Set(),
    }),
    true,
  );

  const withPrice = helpers.requirementSsrSelect(true);
  const withoutPrice = helpers.requirementSsrSelect(false);
  assert.match(withPrice, /\bprice\b/);
  assert.doesNotMatch(withoutPrice, /(^|[^a-z_])price([^a-z_]|$)/i);
  // Ensure we did not accidentally leave a bare "price" word from phone/etc.
  assert.equal(/\bprice\b/.test(withoutPrice), false);

  const exWith = helpers.exchangeSsrSelect(true);
  const exWithout = helpers.exchangeSsrSelect(false);
  assert.match(exWith, /\bprice\b/);
  assert.equal(/\bprice\b/.test(exWithout), false);

  const stripped = helpers.stripListingPrice([
    { id: "1", price: 999, source_city: "A" },
  ]);
  assert.deepEqual(stripped, [{ id: "1", source_city: "A" }]);
  assert.equal(JSON.stringify(stripped).includes("999"), false);

  assert.equal(
    helpers.formatListingFareForDisplay(500, false),
    "***",
  );
  assert.equal(
    helpers.formatListingFareForDisplay(500, true),
    "₹500",
  );
  assert.equal(helpers.formatListingFareForExport(500, false), "***");
  assert.equal(helpers.formatListingFareForExport(500, true), "500");

  console.log("UNIT listing fare helpers: OK");
}

// --- STATIC SSR page ---
{
  const page = read("app/dashboard/page.tsx");
  assert.match(page, /actorCanViewListingFares/);
  assert.match(page, /requirementSsrSelect\(canViewListingFares\)/);
  assert.match(page, /exchangeSsrSelect\(canViewListingFares\)/);
  assert.match(page, /stripListingPrice/);
  assert.match(page, /canViewListingFares=\{canViewListingFares\}/);
  assert.doesNotMatch(
    page,
    /\.from\("requirements"\)\s*\.select\(\s*`[\s\S]*\*/,
  );
  assert.doesNotMatch(
    page,
    /\.from\("exchange_listings"\)\s*\.select\(\s*`[\s\S]*\*/,
  );
  console.log("STATIC SSR fare minimization: OK");
}

// --- STATIC UI / export ---
{
  const tabs = read("app/dashboard/dashboard-tabs.tsx");
  assert.match(tabs, /formatListingFareForDisplay/);
  assert.match(tabs, /formatListingFareForExport/);
  assert.match(tabs, /canViewListingFares/);
  assert.doesNotMatch(tabs, /₹\{item\.price\}/);
  assert.doesNotMatch(
    tabs,
    /Fare:\s*\n\s*item\.price != null/,
  );
  console.log("STATIC UI/export fare gate: OK");
}

// --- Driver budget untouched ---
{
  const changedHint = [
    "lib/admin-permissions.ts",
    "lib/dashboard-listing-fare.ts",
    "app/dashboard/page.tsx",
    "app/dashboard/dashboard-tabs.tsx",
  ];
  for (const rel of changedHint) {
    const src = read(rel);
    assert.doesNotMatch(src, /\bbudget\b/);
  }
  console.log("STATIC driver budget untouched in A18 files: OK");
}

console.log("verify-admin-listing-fare-a18: OK");
console.log(
  "NOTE: HTTP/runtime SSR payload inspection was NOT executed.",
);
