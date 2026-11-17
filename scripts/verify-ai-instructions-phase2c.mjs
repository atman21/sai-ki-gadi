/**
 * Phase 2C — AI Instructions static + helper verification (no live DB / Edge).
 * Run: npm run test:ai-instructions-phase2c
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
    if (id === "@/lib/ai-instructions") return loadTs("lib/ai-instructions.ts");
    throw new Error(`Unexpected require in ${rel}: ${id}`);
  });
  return mod.exports;
}

const instructions = loadTs("lib/ai-instructions.ts");
const adapter = loadTs("lib/ai-instructions-gemini-adapter.ts", {
  "@/lib/ai-instructions": instructions,
});

{
  assert.equal(instructions.assertSkgOnlyDefaultsContainPolicy(), true);
  const defaults = instructions.defaultAiInstructionFields();
  const composed = instructions.composeFinalInstruction(defaults);
  assert.match(composed, /Sai Ki Gadi/i);
  assert.match(composed, /RedBus/i);
  assert.match(composed, /SKG Support/i);
  assert.match(defaults.refusal_message, /Sai Ki Gadi/i);
  assert.match(defaults.refusal_message, /other apps|unrelated/i);
  assert.match(defaults.fallback_message, /SKG Support/i);
  assert.match(defaults.language_behavior, /Gujarati/i);
  assert.match(defaults.language_behavior, /Hindi/i);
  assert.match(defaults.language_behavior, /English/i);
  console.log("OK: SKG-only default instruction + refusal examples");
}

{
  const bad = instructions.sanitizeInstructionFields({
    title: "x",
    main_system_instruction: "GEMINI_API_KEY=abc",
    skg_scope_restriction: "scope",
    refusal_message: "no",
    fallback_message: "no",
    language_behavior: "en",
    allowed_topics: ["bookings"],
  });
  assert.equal(bad.ok, false);

  const good = instructions.sanitizeInstructionFields({
    title: " SKG Assistant ",
    main_system_instruction: "Help with SKG only.",
    skg_scope_restriction: "Sai Ki Gadi only.",
    refusal_message: "Only SKG.",
    fallback_message: "Ask Support.",
    language_behavior: "Reply in en/hi/gu.",
    allowed_topics: ["bookings", "payments", "bookings"],
  });
  assert.equal(good.ok, true);
  assert.deepEqual(good.fields.allowed_topics, ["bookings", "payments"]);
  assert.equal(good.fields.title, "SKG Assistant");

  const emptyTopics = instructions.sanitizeInstructionFields({
    ...good.fields,
    allowed_topics: [],
  });
  assert.equal(emptyTopics.ok, false);
  console.log("OK: instruction sanitization");
}

{
  const snap = instructions.instructionAuditSnapshot({
    id: "skg-ai-global-instructions",
    status: "draft",
    version: 2,
    title: "t",
    main_system_instruction: "secret prompt body",
    skg_scope_restriction: "scope",
    refusal_message: "r",
    fallback_message: "f",
    language_behavior: "l",
    allowed_topics: ["bookings"],
  });
  assert.equal(snap.title, "t");
  assert.ok(snap.lengths);
  assert.equal(snap.lengths.main_system_instruction, "secret prompt body".length);
  assert.equal(snap.main_system_instruction, undefined);
  console.log("OK: audit snapshot omits prompt bodies");
}

{
  const setup = adapter.buildProposedBidiGenerateContentSetup({
    modelId: "gemini-3.8-live",
    fields: instructions.defaultAiInstructionFields(),
  });
  assert.ok(setup.systemInstruction);
  assert.ok(Array.isArray(setup.systemInstruction.parts));
  assert.match(setup.systemInstruction.parts[0].text, /Sai Ki Gadi/i);
  assert.equal(adapter.GEMINI_LIVE_INSTRUCTION_INTEGRATION.runtime_enforced, true);
  assert.equal(
    adapter.GEMINI_LIVE_INSTRUCTION_INTEGRATION.status,
    "wired_server_side",
  );
  const gap = adapter.describeGeminiInstructionIntegrationGap();
  assert.equal(gap.runtime_enforcement, true);
  assert.ok(gap.remaining_work.length >= 1);
  console.log("OK: Gemini integration adapter contract (wired server-side)");
}

{
  const getPut = file("app/api/admin/ai-management/instructions/route.ts");
  assert.match(getPut, /requireAdminPermission\("help_ai\.view"/);
  assert.match(getPut, /requireAdminPermission\("help_ai\.manage"/);
  assert.match(getPut, /help_ai\.instruction\.update/);
  assert.match(getPut, /saveInstructionDraft/);
  assert.doesNotMatch(getPut, /publishInstructionDraft/);
  assert.doesNotMatch(getPut, /mint-skg-ai-live-token|functions\/v1/);
  assert.doesNotMatch(getPut, /GEMINI_API_KEY|SUPABASE_SERVICE_ROLE_KEY/);

  const publish = file(
    "app/api/admin/ai-management/instructions/publish/route.ts",
  );
  assert.match(publish, /requireAdminPermission\("help_ai\.manage"/);
  assert.match(publish, /help_ai\.instruction\.publish/);
  assert.match(publish, /publishInstructionDraft/);
  assert.match(publish, /gemini_runtime_enforced:\s*true/);

  const versions = file(
    "app/api/admin/ai-management/instructions/versions/route.ts",
  );
  assert.match(versions, /requireAdminPermission\("help_ai\.view"/);
  console.log("OK: RBAC + draft vs publish + audit actions");
}

{
  const panel = file("components/admin/ai-instructions-admin-panel.tsx");
  assert.match(panel, /Save Draft/);
  assert.match(panel, /Publish/);
  assert.match(panel, /Final instruction preview/);
  assert.match(panel, /Version history/);
  assert.match(panel, /Save the draft before publishing/);
  assert.match(panel, /help_ai\.manage/);
  assert.doesNotMatch(panel, /supabaseAdmin|from\("skg_ai_/);

  const gate = file("components/admin/ai-management-access-gate.tsx");
  assert.match(gate, /AiInstructionsAdminPanel/);
  assert.match(gate, /ai-instructions/);
  assert.match(gate, /HelpFaqAdminPanel/);
  assert.match(gate, /AiManagementDashboardPanel/);

  const map = loadTs("lib/admin-permissions.ts").TAB_PERMISSION_MAP;
  assert.equal(map["ai-instructions"], "help_ai.view");
  assert.equal(map["ai-faq-help"], "help.view");
  assert.equal(map["ai-dashboard"], "help_ai.view");

  const nav = loadTs("lib/ai-management-nav.ts");
  const item = nav.getAiManagementNavItem("ai-instructions");
  assert.equal(item.viewPermission, "help_ai.view");
  assert.equal(item.managePermission, "help_ai.manage");
  console.log("OK: UI wiring + permissions");
}

{
  const store = file("lib/ai-instructions-store.ts");
  assert.match(store, /postgres/);
  assert.match(store, /from\("skg_ai_instructions"\)/);
  assert.doesNotMatch(store, /var\/skg-ai-instructions/);
  assert.doesNotMatch(store, /filesystem_adapter/);

  const doc = file("docs/ai-management/AI_INSTRUCTIONS_GEMINI_INTEGRATION.md");
  assert.match(doc, /wired in code/i);
  assert.match(doc, /systemInstruction/);
  assert.match(doc, /mint-skg-ai-live-token/);
  console.log("OK: storage adapter + integration doc");
}

console.log("\nPhase 2C AI Instructions verification: passed");
