/**
 * Phase 3B — Knowledge Base static verification (no live DB apply / no Edge deploy).
 * Run: npm run test:ai-knowledge-phase3b
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = (rel) => readFileSync(path.join(root, rel), "utf8");

function loadTs(rel, requireMap = {}) {
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
    if (requireMap[id]) return requireMap[id];
    if (id === "@/lib/admin-permissions") return loadTs("lib/admin-permissions.ts");
    if (id === "@/lib/ai-management-nav") {
      return loadTs("lib/ai-management-nav.ts", {
        "@/lib/admin-permissions": loadTs("lib/admin-permissions.ts"),
      });
    }
    if (id === "@/lib/ai-knowledge-admin") {
      return loadTs("lib/ai-knowledge-admin.ts");
    }
    throw new Error(`Unexpected require in ${rel}: ${id}`);
  });
  return mod.exports;
}

const kb = loadTs("lib/ai-knowledge-admin.ts");

{
  assert.deepEqual(
    kb.AI_KNOWLEDGE_CATEGORY_SEEDS.map((c) => c.key),
    [
      "membership",
      "trip_points",
      "bookings",
      "payments",
      "lucky_draw",
      "driver_services",
      "exchange",
      "help_center",
      "profile",
      "otp_login",
      "general_app",
    ],
  );
  assert.ok(kb.AI_KNOWLEDGE_STATUSES.includes("pending_review"));
  assert.ok(kb.AI_KNOWLEDGE_STATUSES.includes("published"));
  assert.ok(kb.AI_KNOWLEDGE_STATUSES.includes("rejected"));
  assert.equal(kb.GEMINI_KNOWLEDGE_RETRIEVAL.wired, false);
  assert.equal(kb.isGeminiEligibleKnowledge("published"), true);
  assert.equal(kb.isGeminiEligibleKnowledge("draft"), false);
  assert.equal(kb.isGeminiEligibleKnowledge("approved"), false);
  console.log("OK: categories + statuses + Gemini eligibility");
}

{
  assert.equal(kb.canEditKnowledgeContent("draft"), true);
  assert.equal(kb.canEditKnowledgeContent("published"), false);
  assert.equal(kb.canSubmitForReview("rejected"), true);
  assert.equal(kb.canApprove("pending_review"), true);
  assert.equal(kb.canPublish("approved"), true);
  assert.equal(kb.canPublish("draft"), false);
  assert.equal(kb.canUnpublish("published"), true);
  assert.equal(kb.hasEnglishTranslation(["hi", "gu"]), false);
  assert.equal(kb.hasEnglishTranslation(["en", "hi"]), true);

  const badSecret = kb.parseKnowledgeTranslations([
    {
      locale: "en",
      title: "x",
      body: "GEMINI_API_KEY=abc",
    },
  ]);
  assert.equal(badSecret.ok, false);

  const good = kb.parseKnowledgeTranslations([
    { locale: "en", title: "How to book", body: "Use SKG Bookings." },
    { locale: "hi", title: "बुकिंग", body: "SKG में बुकिंग करें।" },
  ]);
  assert.equal(good.ok, true);
  assert.equal(good.translations.length, 2);

  const snap = kb.knowledgeAuditSnapshot({
    id: "a",
    status: "draft",
    title_preview: "Hello world",
  });
  assert.equal(snap.body, undefined);
  assert.ok(!JSON.stringify(snap).includes("GEMINI"));
  console.log("OK: workflow gates + language validation + audit snapshot");
}

{
  const migration = file(
    "supabase/migrations/20261116190000_skg_ai_knowledge_phase3b.sql",
  );
  assert.match(migration, /skg_ai_knowledge_categories/);
  assert.match(migration, /skg_ai_knowledge_articles/);
  assert.match(migration, /skg_ai_knowledge_article_translations/);
  assert.match(migration, /skg_ai_knowledge_article_versions/);
  assert.match(migration, /pending_review/);
  assert.match(migration, /revoke all on table public\.skg_ai_knowledge_articles from public, anon, authenticated/i);
  assert.match(migration, /grant select, insert, update, delete on table public\.skg_ai_knowledge_articles to service_role/i);
  assert.match(migration, /membership/);
  assert.match(migration, /lucky_draw/);
  assert.match(migration, /general_app/);
  assert.doesNotMatch(migration, /₹|Rs\.|membership fee|price is/i);
  assert.match(migration, /Do NOT apply to Production/i);

  const rollback = file(
    "supabase/migrations/20261116190000_skg_ai_knowledge_phase3b.rollback.sql",
  );
  assert.match(rollback, /drop table if exists public\.skg_ai_knowledge_articles/);
  console.log("OK: migration source + isolation + empty category seed");
}

{
  const list = file(
    "app/api/admin/ai-management/knowledge/articles/route.ts",
  );
  assert.match(list, /requireAdminPermission\("help_ai\.view"/);
  assert.match(list, /requireAdminPermission\("help_ai\.manage"/);
  assert.match(list, /help_ai\.knowledge\.create/);
  assert.doesNotMatch(list, /GEMINI_API_KEY|SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(list, /mint-skg-ai-live-token|functions\/v1/);

  const detail = file(
    "app/api/admin/ai-management/knowledge/articles/[id]/route.ts",
  );
  assert.match(detail, /canEditKnowledgeContent/);
  assert.match(detail, /help_ai\.knowledge\.update/);

  const workflow = file(
    "app/api/admin/ai-management/knowledge/articles/[id]/workflow/route.ts",
  );
  assert.match(workflow, /help_ai\.manage/);
  assert.match(workflow, /submit_review/);
  assert.match(workflow, /help_ai\.knowledge\.\$\{action\}/);
  assert.match(workflow, /"approve"/);
  assert.match(workflow, /"publish"/);
  assert.match(workflow, /"unpublish"/);
  assert.match(workflow, /"archive"/);
  assert.match(workflow, /English \(en\) translation is required/);
  assert.match(workflow, /Only approved articles can be published/);

  const versions = file(
    "app/api/admin/ai-management/knowledge/articles/[id]/versions/route.ts",
  );
  assert.match(versions, /help_ai\.view/);
  assert.match(versions, /skg_ai_knowledge_article_versions/);

  const cats = file(
    "app/api/admin/ai-management/knowledge/categories/route.ts",
  );
  assert.match(cats, /help_ai\.view/);
  assert.match(cats, /help_ai\.knowledge\.category\.update/);
  console.log("OK: CRUD + RBAC + workflow + versions APIs");
}

{
  const panel = file("components/admin/ai-knowledge-admin-panel.tsx");
  assert.match(panel, /Knowledge Base/);
  assert.match(panel, /Save Draft/);
  assert.match(panel, /Submit for review/);
  assert.match(panel, /Publish/);
  assert.match(panel, /Version history|Versions/);
  assert.match(panel, /not wired/i);
  assert.doesNotMatch(panel, /supabaseAdmin|from\("skg_ai_knowledge/);

  const gate = file("components/admin/ai-management-access-gate.tsx");
  assert.match(gate, /AiKnowledgeAdminPanel/);
  assert.match(gate, /ai-knowledge-base/);
  assert.match(gate, /AiSettingsAdminPanel/);
  assert.match(gate, /HelpFaqAdminPanel/);
  assert.match(gate, /AiInstructionsAdminPanel/);
  assert.match(gate, /AiManagementDashboardPanel/);

  const map = loadTs("lib/admin-permissions.ts").TAB_PERMISSION_MAP;
  assert.equal(map["ai-knowledge-base"], "help_ai.view");
  assert.equal(map["ai-faq-help"], "help.view");
  assert.equal(map["ai-settings"], "help_ai.manage");

  const doc = file("docs/ai-management/AI_KNOWLEDGE_GEMINI_RETRIEVAL.md");
  assert.match(doc, /NOT wired/i);
  assert.match(doc, /status = 'published'/);
  assert.match(doc, /mint-skg-ai-live-token/);
  console.log("OK: UI wiring + other tabs intact + Gemini doc");
}

console.log("\nPhase 3B Knowledge Base verification: passed");
