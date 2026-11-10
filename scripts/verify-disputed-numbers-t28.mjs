/**
 * T28 — Disputed Numbers (static + pure helper checks).
 * Run: node scripts/verify-disputed-numbers-t28.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mobileRoot = path.resolve(root, "../../home/faijalkhan/Desktop/sai-ki-gadi-V2");
const altMobile = "/home/faijalkhan/Desktop/sai-ki-gadi-V2";
const read = (rel, base = root) => fs.readFileSync(path.join(base, rel), "utf8");

function loadTs(rel, base = root) {
  const abs = path.join(base, rel);
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
  // eslint-disable-next-line no-new-func
  const fn = new Function("exports", "require", "module", outputText);
  fn(module.exports, createRequire(abs), module);
  return module.exports;
}

const mobilePath = fs.existsSync(altMobile) ? altMobile : mobileRoot;

const {
  normalizeIndianMobileForReference,
  isValidDisputedMobile,
} = loadTs("lib/normalize-indian-mobile.ts");

const mobileNorm = loadTs(
  "lib/disallowed-reference-mobile.ts",
  mobilePath,
).normalizeIndianMobileForReference;

const {
  detectImageKindFromBytes,
  validateRemarks,
  DISPUTED_EVIDENCE_MAX_BYTES,
} = loadTs("lib/disputed-number-evidence.ts");

// 1) Normalization parity with mobile project
const samples = [
  "9876543210",
  "+91 98765-43210",
  "919876543210",
  "09876543210",
  "12345",
  "",
];
for (const s of samples) {
  assert.equal(
    normalizeIndianMobileForReference(s),
    mobileNorm(s),
    `normalize mismatch for ${JSON.stringify(s)}`,
  );
}

assert.equal(normalizeIndianMobileForReference("+91 98765 43210"), "9876543210");
assert.equal(isValidDisputedMobile("9876543210"), true);
assert.equal(isValidDisputedMobile("1876543210"), false);
assert.equal(isValidDisputedMobile(null), false);

// 2) Remarks validation
assert.equal(validateRemarks("  ").ok, false);
assert.equal(validateRemarks("Review needed").ok, true);
assert.equal(validateRemarks("x".repeat(2001)).ok, false);

// 3) Magic bytes
const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const png = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
]);
assert.equal(detectImageKindFromBytes(jpeg), "jpeg");
assert.equal(detectImageKindFromBytes(png), "png");
assert.equal(detectImageKindFromBytes(Uint8Array.from([1, 2, 3])), null);
assert.equal(DISPUTED_EVIDENCE_MAX_BYTES, 5 * 1024 * 1024);

// 4) Migration + APIs + UI wiring
const migration = read(
  "supabase/migrations/20261110200000_disputed_numbers.sql",
  mobilePath,
);
assert.match(migration, /create table if not exists public\.disputed_numbers/);
assert.match(migration, /disputed-number-evidence/);
assert.match(migration, /disputed_numbers\.view/);
assert.match(migration, /disputed_numbers\.manage/);
assert.match(migration, /enable row level security/);
assert.doesNotMatch(
  migration,
  /create policy[\s\S]*disputed_numbers[\s\S]*authenticated/i,
);

const perms = read("lib/admin-permissions.ts");
assert.match(perms, /disputed_numbers\.view/);
assert.match(perms, /"disputed-numbers":\s*"disputed_numbers\.view"/);

const route = read("app/api/admin/disputed-numbers/route.ts");
assert.match(route, /requireAdminPermission\("disputed_numbers\.manage"/);
assert.match(route, /normalizeIndianMobileForReference/);
assert.match(route, /validateRemarks/);

const evidenceRoute = read(
  "app/api/admin/disputed-numbers/[id]/evidence/route.ts",
);
assert.match(evidenceRoute, /createSignedUrl/);
assert.match(evidenceRoute, /detectImageKindFromBytes/);
assert.match(evidenceRoute, /remove\(\[previousPath\]\)/);
assert.match(evidenceRoute, /remove\(\[objectPath\]\)/); // rollback on DB fail

const delRoute = read("app/api/admin/disputed-numbers/[id]/route.ts");
assert.match(delRoute, /\.delete\(\)/);
assert.match(delRoute, /DISPUTED_EVIDENCE_BUCKET/);

const tabs = read("app/dashboard/dashboard-tabs.tsx");
assert.match(tabs, /DisputedNumbersPanel/);
assert.match(tabs, /DISPUTED/);
assert.match(tabs, /bg-red-950/);
assert.match(tabs, /"disputed-numbers"/);

const page = read("app/dashboard/page.tsx");
assert.match(page, /disputed_numbers/);
assert.match(page, /isDisputed/);
assert.match(page, /withDisputeFlags/);

const verifyPage = read("app/dashboard/verification/[userId]/page.tsx");
assert.match(verifyPage, /DISPUTED/);
assert.match(verifyPage, /disputed_numbers/);
assert.doesNotMatch(verifyPage, /verification_status.*=.*rejected/);

// 5) Critical: no auto-reject / OTP / login changes from this feature
assert.doesNotMatch(route, /verification_status/);
assert.doesNotMatch(delRoute, /verification_status/);
assert.doesNotMatch(evidenceRoute, /verification_status/);

const otp = read("supabase/functions/verify-login-otp/index.ts", mobilePath);
assert.doesNotMatch(otp, /disputed_numbers/);

console.log("T28 disputed-numbers checks passed.");
