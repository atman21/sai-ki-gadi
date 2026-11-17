/**
 * Phase 2B — AI Management Dashboard static verification (no live DB).
 * Run: npm run test:ai-dashboard-phase2b
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

const metrics = loadTs("lib/ai-dashboard-metrics.ts");

assert.match(metrics.kolkataDateKey(new Date("2026-11-16T10:00:00+05:30")), /^2026-11-16$/);
assert.equal(
  metrics.kolkataDayStartUtcIso("2026-11-16"),
  "2026-11-16T00:00:00.000+05:30",
);
assert.equal(
  metrics.kolkataMonthStartUtcIso("2026-11-16"),
  "2026-11-01T00:00:00.000+05:30",
);

{
  const voice = metrics.deriveVoiceAvailability({
    voice_enabled: true,
    emergency_disabled: false,
    voice_connectivity_verified_at: "2026-11-01T00:00:00Z",
  });
  assert.equal(voice.available, true);

  const blocked = metrics.deriveVoiceAvailability({
    voice_enabled: true,
    emergency_disabled: true,
    voice_connectivity_verified_at: "2026-11-01T00:00:00Z",
  });
  assert.equal(blocked.available, false);

  const unverified = metrics.deriveConnectivityStatus(null);
  assert.equal(unverified.status, "not_verified");
  const verified = metrics.deriveConnectivityStatus("2026-11-01T00:00:00Z");
  assert.equal(verified.status, "verified");
}

assert.equal(
  metrics.sumSettledSeconds([{ settled_seconds: 10 }, { settled_seconds: 5 }]),
  15,
);
assert.deepEqual(
  metrics.countBySessionStatus([
    { status: "ended" },
    { status: "failed" },
    { status: "ended" },
    { status: "active" },
  ]),
  { reserved: 0, active: 1, ended: 2, expired: 0, failed: 1 },
);

{
  const links = metrics.dashboardQuickLinks((p) =>
    ["help_ai.view", "help.view"].includes(p),
  );
  const keys = links.map((l) => l.key);
  assert.ok(keys.includes("ai-faq-help"));
  assert.ok(keys.includes("ai-usage"));
  assert.ok(!keys.includes("ai-settings")); // needs help_ai.manage
  assert.ok(!keys.includes("ai-dashboard"));
  assert.ok(links.every((l) => l.href.startsWith("/dashboard?tab=")));
}
console.log("OK: dashboard metric helpers");

{
  const route = file("app/api/admin/ai-management/dashboard/route.ts");
  assert.match(route, /requireAdminPermission\("help_ai\.view"/);
  assert.match(route, /if\s*\(\s*!gate\.ok\s*\)\s*return\s*gate\.response/);
  assert.match(route, /from\("skg_ai_settings"\)/);
  assert.match(route, /"skg_ai_voice_sessions"/);
  assert.match(route, /"help_faqs"/);
  assert.match(route, /"help_faq_categories"/);
  assert.match(route, /help\.view/);
  assert.match(route, /admin_panel_audit_logs/);
  assert.doesNotMatch(route, /functions\/v1\/|mint-skg-ai-live-token/);
  assert.doesNotMatch(route, /GEMINI_API_KEY|SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(route, /live_gemini_probe:\s*false/);
  assert.match(
    route,
    /does not call verify-skg-ai-gemini-connectivity/,
  );
  console.log("OK: dashboard API permission + sources");
}

{
  const panel = file("components/admin/ai-management-dashboard-panel.tsx");
  assert.match(panel, /\/api\/admin\/ai-management\/dashboard/);
  assert.match(panel, /AI Service Status/);
  assert.match(panel, /Knowledge Overview/);
  assert.match(panel, /AI Usage Overview/);
  assert.match(panel, /Recent Activity/);
  assert.match(panel, /Quick Navigation/);
  assert.match(panel, /Refresh/);
  assert.match(panel, /Loading service status/);
  assert.match(panel, /No recent activity/);
  assert.match(panel, /router\.push\(link\.href\)/);
  assert.doesNotMatch(panel, /from\("skg_ai_|supabaseAdmin/);

  const gate = file("components/admin/ai-management-access-gate.tsx");
  assert.match(gate, /AiManagementDashboardPanel/);
  assert.match(gate, /ai-dashboard/);
  assert.match(gate, /HelpFaqAdminPanel/);
  console.log("OK: dashboard UI + gate wiring");
}

{
  const map = loadTs("lib/admin-permissions.ts").TAB_PERMISSION_MAP;
  assert.equal(map["ai-dashboard"], "help_ai.view");
  assert.equal(map["ai-faq-help"], "help.view");
  console.log("OK: tab permissions intact");
}

console.log("\nPhase 2B AI Dashboard verification: passed");
