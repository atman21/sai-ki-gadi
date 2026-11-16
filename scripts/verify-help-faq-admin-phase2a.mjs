/**
 * Phase 2A — Help FAQ Admin static verification (no live DB).
 * Run: npm run test:help-faq-admin-phase2a
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = (rel) => readFileSync(path.join(root, rel), "utf8");

function loadTs(rel) {
  const compiled = ts.transpileModule(file(rel), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    reportDiagnostics: true,
  });
  assert.equal(
    (compiled.diagnostics ?? []).filter(
      (d) => d.category === ts.DiagnosticCategory.Error,
    ).length,
    0,
    `TS errors in ${rel}`,
  );
  const mod = { exports: {} };
  const run = new Function("exports", "module", "require", compiled.outputText);
  run(mod.exports, mod, (id) => {
    throw new Error(`Unexpected require in ${rel}: ${id}`);
  });
  return mod.exports;
}

const helpers = loadTs("lib/help-faq-admin.ts");

assert.deepEqual([...helpers.HELP_FAQ_LOCALES], ["en", "hi", "gu"]);
assert.equal(helpers.isHelpFaqStatus("draft"), true);
assert.equal(helpers.isHelpFaqStatus("published"), true);
assert.equal(helpers.isHelpFaqStatus("archived"), false);
assert.equal(helpers.canPublishFaq(["gu", "hi"]), false);
assert.equal(helpers.canPublishFaq(["en", "gu"]), true);

{
  const parsed = helpers.parseTranslationInputs([
    { locale: "en", question: "Q?", answer: "A" },
    { locale: "hi", question: "प्र?", answer: "उत्तर" },
  ]);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.translations.length, 2);
}

{
  const bad = helpers.parseTranslationInputs([
    { locale: "en", question: " ", answer: "A" },
  ]);
  assert.equal(bad.ok, false);
}

{
  const dup = helpers.parseTranslationInputs([
    { locale: "en", question: "Q", answer: "A" },
    { locale: "en", question: "Q2", answer: "A2" },
  ]);
  assert.equal(dup.ok, false);
}

assert.deepEqual(
  helpers.mergeLocalePresence(["en"], ["hi", "gu"]),
  ["en", "gu", "hi"],
);

const snap = helpers.faqAuditSnapshot({
  id: "x",
  status: "draft",
  keywords: ["a", "b"],
  locales: ["en"],
});
assert.equal(snap.keywords_count, 2);
assert.equal("question" in snap, false);
assert.equal("answer" in snap, false);
console.log("OK: help-faq-admin helpers");

// Mobile T29 schema compatibility anchors
{
  const mobileSql = readFileSync(
    path.join(
      "/var/www/html/sai-ki-gadi-app/supabase/migrations/20261110210000_skg_ai_help_center.sql",
    ),
    "utf8",
  );
  assert.match(mobileSql, /create table if not exists public\.help_faq_categories/);
  assert.match(mobileSql, /create table if not exists public\.help_faqs/);
  assert.match(mobileSql, /create table if not exists public\.help_faq_translations/);
  assert.match(mobileSql, /status text not null default 'draft'/);
  assert.match(mobileSql, /check \(status in \('draft', 'published'\)\)/);
  assert.match(mobileSql, /locale text not null check \(locale in \('en', 'hi', 'gu'\)\)/);
  assert.doesNotMatch(mobileSql, /help_faq_versions|faq_version_history/);
  console.log("OK: Mobile T29 FAQ schema contract");
}

function assertUsesPermission(rel, permission) {
  const src = file(rel);
  assert.match(
    src,
    new RegExp(
      `requireAdminPermission\\(\\s*["']${permission.replace(".", "\\.")}["']`,
    ),
    `${rel} must require ${permission}`,
  );
  assert.match(
    src,
    /if\s*\(\s*!gate\.ok\s*\)\s*return\s*gate\.response/,
    `${rel} must return denied response`,
  );
}

assertUsesPermission("app/api/admin/help-faq-categories/route.ts", "help.view");
assertUsesPermission("app/api/admin/help-faqs/route.ts", "help.view");
assert.match(file("app/api/admin/help-faqs/route.ts"), /help\.manage/);
assertUsesPermission("app/api/admin/help-faqs/[id]/route.ts", "help.view");
assert.match(file("app/api/admin/help-faqs/[id]/route.ts"), /help\.manage/);
assertUsesPermission(
  "app/api/admin/help-faqs/[id]/publish/route.ts",
  "help.manage",
);
assertUsesPermission(
  "app/api/admin/help-faqs/[id]/unpublish/route.ts",
  "help.manage",
);

{
  const list = file("app/api/admin/help-faqs/route.ts");
  assert.match(list, /help\.faq\.create/);
  assert.match(list, /from\("help_faqs"\)/);
  assert.match(list, /from\("help_faq_translations"\)/);
  assert.doesNotMatch(list, /SUPABASE_SERVICE_ROLE_KEY/);

  const detail = file("app/api/admin/help-faqs/[id]/route.ts");
  assert.match(detail, /help\.faq\.update/);
  assert.match(detail, /upsert/);
  assert.match(detail, /onConflict:\s*["']faq_id,locale["']/);
  assert.match(
    detail,
    /Use \/publish or \/unpublish endpoints to change publication status/,
  );

  const publish = file("app/api/admin/help-faqs/[id]/publish/route.ts");
  assert.match(publish, /help\.faq\.publish/);
  assert.match(publish, /canPublishFaq/);
  assert.match(publish, /status:\s*["']published["']/);

  const unpublish = file("app/api/admin/help-faqs/[id]/unpublish/route.ts");
  assert.match(unpublish, /help\.faq\.unpublish/);
  assert.match(unpublish, /status:\s*["']draft["']/);
  console.log("OK: FAQ API RBAC + audit actions");
}

{
  const panel = file("components/admin/help-faq-admin-panel.tsx");
  assert.match(panel, /help\.manage/);
  assert.match(panel, /Create FAQ/);
  assert.match(panel, /Mobile preview/);
  assert.match(panel, /Showing English fallback/);
  assert.match(panel, /\/api\/admin\/help-faqs/);
  assert.match(panel, /publish/);
  assert.match(panel, /unpublish/);
  assert.match(panel, /View only/);

  const gate = file("components/admin/ai-management-access-gate.tsx");
  assert.match(gate, /HelpFaqAdminPanel/);
  assert.match(gate, /ai-faq-help/);

  assert.equal(
    loadTs("lib/admin-permissions.ts").TAB_PERMISSION_MAP["ai-faq-help"],
    "help.view",
  );
  console.log("OK: FAQ UI wiring + permission map");
}

console.log("\nPhase 2A Help FAQ Admin verification: passed");
