/**
 * Phase 2E — AI Settings static verification (no live DB / no Edge deploy).
 * Run: npm run test:ai-settings-phase2e
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
    throw new Error(`Unexpected require in ${rel}: ${id}`);
  });
  return mod.exports;
}

const settings = loadTs("lib/ai-settings-admin.ts");

{
  assert.deepEqual(settings.SKG_AI_ALLOWED_LIVE_MODELS, ["gemini-3.8-live"]);
  assert.equal(settings.isAllowedLiveModel("gemini-3.8-live"), true);
  assert.equal(settings.isAllowedLiveModel("gemini-pro"), false);
  assert.equal(settings.normalizeModelId("models/gemini-3.8-live"), "gemini-3.8-live");
  console.log("OK: model allowlist mirrors Edge");
}

{
  const current = {
    id: 1,
    help_center_enabled: true,
    voice_enabled: false,
    voice_connectivity_verified_at: null,
    weekly_allowance_seconds: 600,
    max_session_seconds: 120,
    lease_seconds: 20,
    gemini_model_id: "gemini-3.8-live",
    supported_locales: ["en", "hi", "gu"],
    session_resumption_enabled: false,
    emergency_disabled: false,
    emergency_reason: null,
    emergency_disabled_at: null,
    emergency_disabled_by: null,
    updated_at: null,
    updated_by: null,
  };

  const badModel = settings.sanitizeAiSettingsUpdate(
    { gemini_model_id: "not-a-model" },
    current,
  );
  assert.equal(badModel.ok, false);

  const badQuota = settings.sanitizeAiSettingsUpdate(
    { weekly_allowance_seconds: 9999 },
    current,
  );
  assert.equal(badQuota.ok, false);

  const voiceWithoutStamp = settings.sanitizeAiSettingsUpdate(
    { voice_enabled: true },
    current,
  );
  assert.equal(voiceWithoutStamp.ok, false);

  const voiceWithStamp = settings.sanitizeAiSettingsUpdate(
    { voice_enabled: true, mark_voice_connectivity_verified: true },
    current,
  );
  assert.equal(voiceWithStamp.ok, true);
  assert.equal(voiceWithStamp.markConnectivity, true);

  const locales = settings.sanitizeAiSettingsUpdate(
    {
      supported_locales: ["gu", "en"],
      default_locale: "gu",
    },
    current,
  );
  assert.equal(locales.ok, true);
  assert.deepEqual(locales.patch.supported_locales, ["gu", "en"]);

  const pub = settings.publicAiSettingsView(current);
  assert.ok(!("GEMINI_API_KEY" in pub));
  assert.ok(pub.schema_notes.skg_only_scope);
  assert.equal(pub.default_locale, "en");
  console.log("OK: sanitize + bounds + voice connectivity gate");
}

{
  const route = file("app/api/admin/ai-management/settings/route.ts");
  assert.match(route, /requireAdminPermission\("help_ai\.manage"/);
  assert.match(route, /from\("skg_ai_settings"\)/);
  assert.match(route, /help_ai\.settings\.update/);
  assert.match(route, /help_ai\.voice_connectivity\.verify/);
  assert.doesNotMatch(route, /GEMINI_API_KEY|SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(route, /mint-skg-ai-live-token|functions\/v1/);
  assert.match(route, /gemini_live_untouched:\s*true/);

  const emergency = file(
    "app/api/admin/ai-management/settings/emergency/route.ts",
  );
  assert.match(emergency, /requireAdminPermission\("help_ai\.manage"/);
  assert.match(emergency, /emergency_terminate_skg_ai_sessions/);
  assert.match(emergency, /help_ai\.emergency_disable/);
  assert.match(emergency, /help_ai\.emergency_enable/);
  assert.doesNotMatch(emergency, /mint-skg-ai-live-token/);
  console.log("OK: settings + emergency API RBAC/audit");
}

{
  const panel = file("components/admin/ai-settings-admin-panel.tsx");
  assert.match(panel, /\/api\/admin\/ai-management\/settings/);
  assert.match(panel, /Save settings/);
  assert.match(panel, /window\.confirm/);
  assert.match(panel, /Disable the AI Help Center/);
  assert.match(panel, /Disable Voice AI/);
  assert.match(panel, /maintenance \/ emergency/i);
  assert.match(panel, /Open AI Instructions/);
  assert.doesNotMatch(panel, /supabaseAdmin|from\("skg_ai_settings"\)/);

  const gate = file("components/admin/ai-management-access-gate.tsx");
  assert.match(gate, /AiSettingsAdminPanel/);
  assert.match(gate, /ai-settings/);
  assert.match(gate, /AiManagementDashboardPanel/);
  assert.match(gate, /HelpFaqAdminPanel/);
  assert.match(gate, /AiInstructionsAdminPanel/);

  const map = loadTs("lib/admin-permissions.ts").TAB_PERMISSION_MAP;
  assert.equal(map["ai-settings"], "help_ai.manage");
  assert.equal(map["ai-dashboard"], "help_ai.view");
  assert.equal(map["ai-faq-help"], "help.view");
  assert.equal(map["ai-instructions"], "help_ai.view");
  console.log("OK: UI wiring + other tabs intact");
}

{
  // Confirm Mobile allowlist still matches (read-only check; do not modify Mobile).
  const mobileShared = file(
    "../sai-ki-gadi-app/supabase/functions/_shared/skg-ai-live-token.ts",
  );
  assert.match(mobileShared, /SKG_AI_ALLOWED_LIVE_MODELS/);
  assert.match(mobileShared, /"gemini-3.8-live"/);
  assert.doesNotMatch(mobileShared, /"gemini-2\.5-flash-live"/);
  console.log("OK: Mobile Edge allowlist parity (read-only)");
}

console.log("\nPhase 2E AI Settings verification: passed");
