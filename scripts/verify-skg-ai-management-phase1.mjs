/**
 * Phase 1 — SKG AI Management Console (static + unit).
 * Run: npm run test:skg-ai-management-phase1
 *
 * Does not prove live HTTP/DB against a running server.
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
  const errors = (compiled.diagnostics ?? []).filter(
    (d) => d.category === ts.DiagnosticCategory.Error,
  );
  assert.equal(errors.length, 0, `TS errors in ${rel}`);
  const mod = { exports: {} };
  const run = new Function("exports", "module", "require", compiled.outputText);
  run(mod.exports, mod, (id) => {
    if (requireMap[id]) return requireMap[id];
    if (id === "@/lib/admin-permissions") {
      return loadTs("lib/admin-permissions.ts");
    }
    throw new Error(`Unexpected require in ${rel}: ${id}`);
  });
  return mod.exports;
}

const HELP_PERMS = [
  "help.view",
  "help.manage",
  "help_ai.view",
  "help_ai.manage",
];

// --- Permission catalog ---
{
  const perms = loadTs("lib/admin-permissions.ts");
  for (const key of HELP_PERMS) {
    assert.ok(perms.ADMIN_PERMISSIONS.includes(key), `catalog has ${key}`);
    assert.equal(perms.isAdminPermission(key), true);
  }

  assert.equal(perms.TAB_PERMISSION_MAP["ai-dashboard"], "help_ai.view");
  assert.equal(perms.TAB_PERMISSION_MAP["ai-settings"], "help_ai.manage");
  assert.equal(perms.TAB_PERMISSION_MAP["ai-faq-help"], "help.view");
  assert.equal(perms.TAB_PERMISSION_MAP["ai-knowledge-import"], "help_ai.manage");
  assert.equal(perms.TAB_PERMISSION_MAP["ai-usage"], "help_ai.view");
  assert.equal(perms.TAB_PERMISSION_MAP["users"], "members.view");

  const helpMod = perms.PERMISSION_MODULES.find((m) => m.module === "help");
  const aiMod = perms.PERMISSION_MODULES.find((m) => m.module === "help_ai");
  assert.ok(helpMod, "help permission module");
  assert.ok(aiMod, "help_ai permission module");
  assert.deepEqual(helpMod.permissions, ["help.view", "help.manage"]);
  assert.deepEqual(aiMod.permissions, ["help_ai.view", "help_ai.manage"]);
  console.log("OK: permission catalog + tab map");
}

// --- Nav contract: visibility by permission ---
{
  const nav = loadTs("lib/ai-management-nav.ts");
  assert.equal(nav.AI_MANAGEMENT_NAV_GROUP_TITLE, "SKG AI MANAGEMENT");
  assert.equal(nav.AI_MANAGEMENT_NAV_ITEMS.length, 11);
  assert.equal(nav.AI_MANAGEMENT_TAB_KEYS.length, 11);

  const none = nav.filterAiManagementNavItems(() => false);
  assert.equal(none.length, 0, "no permissions → no AI nav");

  const viewOnly = new Set(["help.view", "help_ai.view"]);
  const viewItems = nav.filterAiManagementNavItems((p) => viewOnly.has(p));
  const viewKeys = viewItems.map((i) => i.key);
  assert.ok(viewKeys.includes("ai-dashboard"));
  assert.ok(viewKeys.includes("ai-faq-help"));
  assert.ok(viewKeys.includes("ai-usage"));
  assert.ok(viewKeys.includes("ai-instructions"), "view can read AI Instructions");
  assert.ok(!viewKeys.includes("ai-settings"), "view-only cannot see settings");
  assert.ok(!viewKeys.includes("ai-test-assistant"), "view-only cannot see test");
  assert.ok(!viewKeys.includes("ai-knowledge-import"));

  const manageAi = new Set(["help_ai.view", "help_ai.manage"]);
  const manageItems = nav.filterAiManagementNavItems((p) => manageAi.has(p));
  assert.ok(manageItems.some((i) => i.key === "ai-settings"));
  assert.ok(
    !manageItems.some((i) => i.key === "ai-faq-help"),
    "help_ai alone does not unlock FAQ tab",
  );

  const faqOnly = nav.filterAiManagementNavItems((p) => p === "help.view");
  assert.deepEqual(
    faqOnly.map((i) => i.key),
    ["ai-faq-help"],
  );

  assert.equal(
    nav.isAiManagementNavGroupTitle("SKG AI MANAGEMENT"),
    true,
  );
  assert.equal(nav.isAiManagementNavGroupTitle("Content"), false);

  assert.equal(
    nav.resolveAiManagementPanelAccess("ai-settings", {
      permissionsReady: false,
      hasPermission: () => true,
    }),
    "loading",
  );
  assert.equal(
    nav.resolveAiManagementPanelAccess("ai-settings", {
      permissionsReady: true,
      hasPermission: () => false,
    }),
    "denied",
  );
  assert.equal(
    nav.resolveAiManagementPanelAccess("ai-settings", {
      permissionsReady: true,
      hasPermission: (p) => p === "help_ai.manage",
    }),
    "allow",
  );
  assert.equal(
    nav.resolveAiManagementPanelAccess("ai-dashboard", {
      permissionsReady: true,
      hasPermission: (p) => p === "help_ai.view",
    }),
    "allow",
  );
  assert.equal(
    nav.resolveAiManagementPanelAccess("ai-dashboard", {
      permissionsReady: true,
      hasPermission: () => false,
    }),
    "denied",
  );
  console.log("OK: AI nav visibility view vs manage + panel access states");
}

// --- Dashboard wiring + regression ---
{
  const tabs = file("app/dashboard/dashboard-tabs.tsx");
  assert.match(tabs, /AI_MANAGEMENT_NAV_GROUP_TITLE/);
  assert.match(tabs, /AiManagementAccessGate/);
  assert.doesNotMatch(
    tabs,
    /isAiManagementTabKey\(activeTab\)\s*\?\s*<AiManagementPlaceholderPanel/,
  );
  assert.match(tabs, /isAiManagementTabKey/);
  assert.match(tabs, /isAiManagementNavGroupTitle/);
  assert.match(tabs, /permissionsReady/);
  // Loading path must strip AI nav group items
  assert.match(tabs, /isAiManagementNavGroupTitle\(section\.title\)/);
  assert.match(tabs, /items:\s*\[\]/);
  assert.match(tabs, /SKG AI MANAGEMENT|AI_MANAGEMENT_NAV_GROUP_TITLE/);
  // Existing redirect fallback retained
  assert.match(tabs, /selectTab\("overview"\)/);
  // Existing nav still present
  assert.match(tabs, /title: "Content"/);
  assert.match(tabs, /title: "Administration"/);
  assert.match(tabs, /key: "users"/);
  assert.match(tabs, /key: "audit-logs"/);
  assert.match(tabs, /MemberReviewsPanel/);

  const icons = file("app/dashboard/admin-nav-icons.tsx");
  for (const key of [
    "ai-dashboard",
    "ai-settings",
    "ai-faq-help",
    "ai-test-assistant",
    "ai-security-audit",
  ]) {
    assert.match(icons, new RegExp(`"${key}"`));
  }

  const panel = file(
    "components/admin/ai-management-placeholder-panel.tsx",
  );
  assert.match(panel, /Phase 1 shell/);
  assert.doesNotMatch(panel, /GEMINI_API_KEY|mint-skg-ai|functions\.invoke/i);

  const gate = file("components/admin/ai-management-access-gate.tsx");
  assert.match(gate, /resolveAiManagementPanelAccess/);
  assert.match(gate, /Checking access/);
  assert.match(gate, /Access restricted/);
  assert.match(gate, /AiManagementPlaceholderPanel/);
  assert.doesNotMatch(gate, /GEMINI_API_KEY|mint-skg-ai/);
  console.log("OK: dashboard nav shell + access gate + regression anchors");
}

// --- Unauthorized API contract ---
{
  const status = file("app/api/admin/ai-management/status/route.ts");
  assert.match(status, /requireAdminPermission\("help_ai\.view"/);
  assert.match(status, /if\s*\(\s*!gate\.ok\s*\)\s*return\s*gate\.response/);
  assert.match(status, /phase:\s*1/);
  assert.match(status, /featuresEnabled:\s*false/);
  assert.doesNotMatch(status, /GEMINI|skg_ai_settings|from\("/);
  console.log("OK: status API permission gate");
}

// --- Migration source (not applied) ---
{
  const migration = file(
    "supabase/migrations/20261116120000_skg_ai_admin_permissions_phase1.sql",
  );
  assert.match(migration, /help\.view/);
  assert.match(migration, /help_ai\.manage/);
  assert.match(migration, /on conflict \(key\) do update/);
  assert.match(migration, /lower\(r\.slug\) in \('super_admin', 'admin'\)/);
  assert.match(migration, /lower\(r\.slug\) = 'manager'/);
  assert.match(migration, /lower\(r\.slug\) = 'operator'/);
  // manager grant block: three view/manage FAQ + AI view keys only
  assert.match(
    migration,
    /values\s*\n\s*\('help\.view'\),\s*\n\s*\('help\.manage'\),\s*\n\s*\('help_ai\.view'\)\s*\n\) as p\(key\)\s*\nwhere lower\(r\.slug\) = 'manager'/,
  );
  assert.match(
    migration,
    /where lower\(r\.slug\) = 'operator'/,
  );
  assert.doesNotMatch(migration, /create table/i);
  console.log("OK: additive permission migration source");
}

// --- Docs present ---
{
  for (const rel of [
    "docs/ai-management/PHASE_1_FOUNDATION_DESIGN.md",
    "docs/ai-management/AI_DATABASE_SCHEMA_DESIGN.md",
    "docs/ai-management/AI_SECURITY_ARCHITECTURE.md",
    "docs/ai-management/PHASE_1_IMPLEMENTATION_REPORT.md",
  ]) {
    assert.match(file(rel), /Phase 1/);
  }
  console.log("OK: Phase 1 documents present");
}

console.log("\nSKG AI Management Phase 1 verification: passed");
