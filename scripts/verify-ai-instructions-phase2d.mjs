/**
 * Phase 2D — AI Instructions Postgres + Gemini runtime wiring verification.
 * Run: npm run test:ai-instructions-phase2d
 * No live DB / Edge / deploy.
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mobileRoot = path.resolve(root, "../sai-ki-gadi-app");
const file = (rel) => readFileSync(path.join(root, rel), "utf8");
const mobileFile = (rel) => readFileSync(path.join(mobileRoot, rel), "utf8");

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
  const composed = instructions.composeFinalInstruction(
    instructions.defaultAiInstructionFields(),
  );
  assert.match(composed, /Sai Ki Gadi/i);
  assert.match(composed, /RedBus/i);
  assert.match(composed, /do not invent/i);
  assert.match(composed, /SKG Support/i);
  console.log("OK: SKG / unrelated refusal defaults");
}

{
  const setup = adapter.buildProposedBidiGenerateContentSetup({
    modelId: "gemini-3.8-live",
    fields: instructions.defaultAiInstructionFields(),
  });
  assert.ok(setup.systemInstruction.parts[0].text.includes("Sai Ki Gadi"));
  assert.equal(adapter.GEMINI_LIVE_INSTRUCTION_INTEGRATION.runtime_enforced, true);
  assert.equal(
    adapter.GEMINI_LIVE_INSTRUCTION_INTEGRATION.status,
    "wired_server_side",
  );
  const gap = adapter.describeGeminiInstructionIntegrationGap();
  assert.equal(gap.runtime_enforcement, true);
  console.log("OK: Gemini adapter marked runtime-enforced");
}

{
  const store = file("lib/ai-instructions-store.ts");
  assert.match(store, /storage:\s*"postgres"/);
  assert.match(store, /from\("skg_ai_instructions"\)/);
  assert.match(store, /from\("skg_ai_instruction_versions"\)/);
  assert.match(store, /global-draft/);
  assert.match(store, /global-published/);
  assert.match(store, /supabaseAdmin/);
  assert.doesNotMatch(store, /var\/skg-ai-instructions/);
  assert.doesNotMatch(store, /filesystem_adapter/);
  assert.match(store, /gemini_runtime_enforced:\s*true/);
  // Draft save must not write published id.
  assert.match(store, /saveInstructionDraft/);
  assert.match(store, /publishInstructionDraft/);
  console.log("OK: Postgres store replaces filesystem");
}

{
  const publish = file(
    "app/api/admin/ai-management/instructions/publish/route.ts",
  );
  assert.match(publish, /gemini_runtime_enforced:\s*true/);
  assert.match(publish, /help_ai\.instruction\.publish/);
  assert.match(publish, /instructionAuditSnapshot/);
  assert.doesNotMatch(publish, /main_system_instruction:\s*result/);

  const getPut = file("app/api/admin/ai-management/instructions/route.ts");
  assert.match(getPut, /Postgres skg_ai_instructions/);
  assert.doesNotMatch(getPut, /Filesystem adapter/);
  console.log("OK: Admin API flags + audit metadata");
}

{
  const doc = file("docs/ai-management/AI_INSTRUCTIONS_GEMINI_INTEGRATION.md");
  assert.match(doc, /wired in code/i);
  assert.match(doc, /systemInstruction/);
  assert.match(doc, /global-published/);
  assert.match(doc, /client WebSocket setup is ignored/i);
  console.log("OK: integration doc updated");
}

{
  assert.ok(existsSync(mobileRoot), "Mobile repo sibling path required");
  const migration = mobileFile(
    "supabase/migrations/20261116180000_skg_ai_instructions_phase2d.sql",
  );
  assert.match(migration, /skg_ai_instructions/);
  assert.match(migration, /skg_ai_instruction_runtime_usage/);
  const mint = mobileFile(
    "supabase/functions/mint-skg-ai-live-token/index.ts",
  );
  assert.match(mint, /resolvePublishedInstructionFromQuery/);
  assert.match(mint, /systemInstructionText/);
  assert.match(mint, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(mint, /\.eq\(\s*"id",\s*"global-draft"/);
  const socket = mobileFile("services/help/skg-ai-live-socket.ts");
  assert.doesNotMatch(socket, /systemInstruction/);
  console.log("OK: Mobile migration + mint wiring cross-check");
}

console.log("\nPhase 2D AI Instructions verification: passed");
