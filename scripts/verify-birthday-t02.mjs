/**
 * T02 Birthday Automation — Admin static/unit checks (no live DB/FCM).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

function loadTs(rel) {
  const abs = path.join(root, rel);
  const { outputText } = ts.transpileModule(read(rel), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: abs,
  });
  const mod = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function("exports", "module", "require", outputText)(
    mod.exports,
    mod,
    require,
  );
  return mod.exports;
}

const {
  formatBirthdayDigestBody,
  evaluateBirthdayDeliveryGate,
  PRODUCTION_SUPABASE_PROJECT_REF,
  STAGING_SUPABASE_PROJECT_REF,
} = loadTs("lib/birthday/birthday-notification-schedule.ts");

assert.equal(formatBirthdayDigestBody([]), null);
assert.match(formatBirthdayDigestBody(["Ravi"]) ?? "", /Ravi/);
assert.match(
  formatBirthdayDigestBody(["A", "B", "C", "D", "E", "F"]) ?? "",
  /and 1 other/,
);

assert.equal(
  evaluateBirthdayDeliveryGate({
    deliveryFlag: undefined,
    supabaseUrl: `https://${STAGING_SUPABASE_PROJECT_REF}.supabase.co`,
    testTokens: [],
  }).allowed,
  false,
);

assert.equal(
  evaluateBirthdayDeliveryGate({
    deliveryFlag: "enabled",
    supabaseUrl: `https://${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co`,
    testTokens: [],
  }).allowed,
  false,
);

const stagingGate = evaluateBirthdayDeliveryGate({
  deliveryFlag: "staging",
  supabaseUrl: `https://${STAGING_SUPABASE_PROJECT_REF}.supabase.co`,
  testTokens: [`dGVzdA:APA91b${"x".repeat(140)}`],
});
assert.equal(stagingGate.allowed, true);
assert.equal(stagingGate.mode, "staging");

const birthRoute = read("app/api/admin/users/[id]/birth-date/route.ts");
assert.match(birthRoute, /requireAdminPermission\("members\.edit"/);
assert.match(birthRoute, /birth_date/);
assert.doesNotMatch(birthRoute, /date_of_birth/);

const ef = read("supabase/functions/send-birthday-notification/index.ts");
assert.match(ef, /formatBirthdayDigestBody/);
assert.match(ef, /notification_type: "birthday"/);
assert.match(ef, /birthday_notification_digests/);
assert.match(ef, /listDigestDevices/);

const migration = read(
  "supabase/migrations/20261110120000_birthday_digest_and_list_names.sql",
);
assert.match(migration, /list_today_birthday_names/);
assert.match(migration, /birthday_notification_digests/);
assert.doesNotMatch(migration, /drop table if exists public\.birthday_notification_logs/);

const profile = read("app/dashboard/components/admin-user-profile-sections.tsx");
assert.match(profile, /label="Date of Birth"/);
assert.doesNotMatch(profile, /label="Birth Date"/);

console.log("verify-birthday-t02: OK");
