import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = (p) => readFileSync(path.join(root, p), "utf8");

function loadValidator() {
  const compiled = ts.transpileModule(file("lib/fraud-report-input.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    reportDiagnostics: true,
  });
  assert.equal(compiled.diagnostics?.length ?? 0, 0);
  const mod = { exports: {} };
  const run = new Function("exports", "module", compiled.outputText);
  run(mod.exports, mod);
  return mod.exports.parseFraudReportCreateInput;
}

const parse = loadValidator();
const from = "11111111-2222-3333-4444-555555555555";
const to = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const valid = { from_user_id: from, to_user_id: to, reason: "  No show  ", description: "  Comment  " };
assert.deepEqual(parse(valid), {
  from_user_id: from,
  to_user_id: to,
  reason: "No show",
  description: "Comment",
});
assert.equal(parse(null), null);
assert.equal(parse([]), null);
assert.equal(parse({ ...valid, from_user_id: "not-a-uuid" }), null);
assert.equal(parse({ ...valid, to_user_id: "" }), null);
assert.equal(parse({ ...valid, reason: "   " }), null);
assert.equal(parse({ ...valid, reason: "x".repeat(251) }), null);
assert.equal(parse({ ...valid, description: { unsafe: true } }), null);
assert.equal(parse({ ...valid, description: "x".repeat(4001) }), null);
assert.equal(parse({ ...valid, description: "   " }).description, null);
assert.equal("admin" in parse({ ...valid, admin: true }), false);

const route = file("app/api/admin/fraud-reports/route.ts");
assert.match(route, /requireAdminPermission\("fraud\.manage"/);
assert.match(route, /if \(!adminGate\.ok\) return adminGate\.response/);
assert.match(route, /parseFraudReportCreateInput\(json\)/);
assert.doesNotMatch(route, /requireAdminApi\(/);
console.log("Fraud report admin authorization + input validation: passed");
