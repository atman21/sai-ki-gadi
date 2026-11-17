/**
 * T12 — Member Reviews Admin static verification (no live DB).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = (p) => readFileSync(path.join(root, p), "utf8");

function loadTs(rel) {
  const compiled = ts.transpileModule(file(rel), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    reportDiagnostics: true,
  });
  assert.equal(
    (compiled.diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error)
      .length,
    0,
  );
  const mod = { exports: {} };
  const run = new Function("exports", "module", "require", compiled.outputText);
  run(mod.exports, mod, (id) => {
    if (id === "@/lib/admin-uuid") return loadTs("lib/admin-uuid.ts");
    throw new Error(`Unexpected require: ${id}`);
  });
  return mod.exports;
}

const migration = file(
  "supabase/migrations/20261110180000_member_reviews_t12.sql",
);
assert.match(migration, /create table if not exists public\.member_reviews/);
assert.match(migration, /create table if not exists public\.member_review_reports/);
assert.match(migration, /member_reviews_no_self_review/);
assert.match(migration, /member_reviews_one_active_per_pair_uidx/);
assert.match(migration, /status <> 'removed'/);
assert.match(migration, /search_member_for_review/);
assert.match(migration, /submit_member_review/);
assert.match(migration, /get_my_member_review_for_subject/);
assert.match(migration, /list_published_member_reviews/);
assert.match(migration, /report_member_review/);
assert.match(migration, /verified is not true/);
assert.doesNotMatch(migration, /membership_type/);
assert.doesNotMatch(
  migration,
  /membership_type\s*=\s*'gold'|paid.?gold|require.*gold/i,
);
assert.match(migration, /and r\.status = 'published'/);
assert.match(migration, /reviews\.view/);
assert.match(migration, /reviews\.moderate/);
assert.match(migration, /grant execute on function public\.search_member_for_review/);
assert.match(migration, /revoke all on table public\.member_reviews from public, anon, authenticated/);

const perms = loadTs("lib/admin-permissions.ts");
assert.ok(perms.ADMIN_PERMISSIONS.includes("reviews.view"));
assert.ok(perms.ADMIN_PERMISSIONS.includes("reviews.moderate"));
assert.equal(perms.TAB_PERMISSION_MAP["member-reviews"], "reviews.view");

const input = loadTs("lib/member-review-admin-input.ts");
assert.equal(input.parseModerateAction("hide"), "hide");
assert.equal(input.parseModerateAction("nope"), null);
assert.equal(input.statusAfterModerate("hide"), "hidden");
assert.equal(input.statusAfterModerate("unhide"), "published");
assert.equal(input.statusAfterModerate("remove"), "removed");
assert.equal(input.parseResolveReportStatus("resolved"), "resolved");
assert.equal(input.parseResolveReportStatus("open"), null);

const listRoute = file("app/api/admin/member-reviews/route.ts");
assert.match(listRoute, /requireAdminPermission\("reviews\.view"/);
assert.doesNotMatch(listRoute, /SUPABASE_SERVICE_ROLE_KEY/);

const modRoute = file("app/api/admin/member-reviews/[id]/route.ts");
assert.match(modRoute, /requireAdminPermission\("reviews\.moderate"/);
assert.match(modRoute, /parseModerateAction/);
assert.match(modRoute, /member_review_hidden/);
assert.match(modRoute, /member_review_removed/);
assert.doesNotMatch(modRoute, /\.delete\(/);

const repRoute = file("app/api/admin/member-review-reports/[id]/route.ts");
assert.match(repRoute, /requireAdminPermission\("reviews\.moderate"/);

const tabs = file("app/dashboard/dashboard-tabs.tsx");
assert.match(tabs, /"member-reviews"/);
assert.match(tabs, /MemberReviewsPanel/);

const panel = file("components/admin/member-reviews-panel.tsx");
assert.match(panel, /reviews\.moderate/);
assert.match(panel, /"hide"/);

console.log("T12 member reviews admin migration + RBAC + APIs: passed");
