/**
 * Lucky Draw prize expiry validation.
 * Run: node scripts/verify-lucky-draw-expiry.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const ts = require("typescript");

function loadTsModule(relPath) {
  const abs = path.join(root, relPath);
  const source = fs.readFileSync(abs, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: abs,
  });
  const module = { exports: {} };
  const fn = new Function("exports", "require", "module", outputText);
  fn(module.exports, require, module);
  return module.exports;
}

const { evaluateLuckyDrawExpiry, kolkataDateKey, parseCivilDate } = loadTsModule(
  "lib/lucky-draw-prize-expiry.ts",
);

assert.equal(kolkataDateKey(new Date("2026-10-28T18:29:00.000Z")), "2026-10-28");
assert.equal(kolkataDateKey(new Date("2026-10-28T18:30:00.000Z")), "2026-10-29");
assert.equal(parseCivilDate("2026-02-31"), null);
assert.equal(parseCivilDate("2026-11-05"), "2026-11-05");

const blank = evaluateLuckyDrawExpiry({
  transactionType: "credit",
  source: "lucky_draw_prize",
  expiresOnRaw: "  ",
  todayKey: "2026-11-01",
});
assert.deepEqual(blank, { action: "post", expiresOn: null });

const held = evaluateLuckyDrawExpiry({
  transactionType: "credit",
  source: "lucky_draw_prize",
  expiresOnRaw: "2026-11-05",
  todayKey: "2026-11-01",
});
assert.equal(held.action, "hold");
assert.equal(held.status, 409);
assert.equal(held.expiresOn, "2026-11-05");

const today = evaluateLuckyDrawExpiry({
  transactionType: "credit",
  source: "lucky_draw_prize",
  expiresOnRaw: "2026-11-01",
  todayKey: "2026-11-01",
});
assert.equal(today.action, "hold");

const past = evaluateLuckyDrawExpiry({
  transactionType: "credit",
  source: "lucky_draw_prize",
  expiresOnRaw: "2026-10-31",
  todayKey: "2026-11-01",
});
assert.equal(past.action, "reject");
assert.equal(past.status, 400);

const invalid = evaluateLuckyDrawExpiry({
  transactionType: "credit",
  source: "lucky_draw_prize",
  expiresOnRaw: "05/11/2026",
  todayKey: "2026-11-01",
});
assert.equal(invalid.action, "reject");

for (const source of ["admin_credit", "refund", "admin_adjustment"]) {
  const decision = evaluateLuckyDrawExpiry({
    transactionType: "credit",
    source,
    expiresOnRaw: "2026-11-05",
    todayKey: "2026-11-01",
  });
  assert.equal(decision.action, "reject", source);
  assert.equal(decision.status, 400, source);
}

const debit = evaluateLuckyDrawExpiry({
  transactionType: "debit",
  source: "wallet_usage",
  expiresOnRaw: "2026-11-05",
  todayKey: "2026-11-01",
});
assert.equal(debit.action, "reject");

const debitBlank = evaluateLuckyDrawExpiry({
  transactionType: "debit",
  source: "wallet_usage",
  expiresOnRaw: null,
  todayKey: "2026-11-01",
});
assert.deepEqual(debitBlank, { action: "post", expiresOn: null });

const route = fs.readFileSync(
  path.join(root, "app/api/admin/users/[id]/wallet/route.ts"),
  "utf8",
);
const holdAt = route.indexOf('expiry.action !== "post"');
const rpcAt = route.indexOf("admin_post_wallet_transaction");
assert.ok(holdAt > 0);
assert.ok(rpcAt > holdAt);
for (const forbidden of [
  "p_expires_on",
  "wallet_credit_lots",
  ".update(",
  ".delete(",
  "reward_expiry",
]) {
  assert.equal(route.includes(forbidden), false, forbidden);
}

const panel = fs.readFileSync(
  path.join(root, "app/dashboard/components/admin-wallet-panel.tsx"),
  "utf8",
);
assert.ok(panel.includes('type="date"'));
assert.ok(panel.includes("expiryAllowed"));
assert.ok(panel.includes('source === "lucky_draw_prize"'));
assert.ok(
  panel.indexOf("const expiry = evaluateLuckyDrawExpiry") <
    panel.indexOf("window.confirm"),
);

console.log("lucky draw prize expiry checks passed");
