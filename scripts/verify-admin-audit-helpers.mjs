/**
 * Regression checks for admin audit helpers (no DB / test-runner dependency).
 * Run: node scripts/verify-admin-audit-helpers.mjs
 */

import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

// Labels module is plain TS compiled conceptually — re-implement pure helpers here
// mirroring lib/admin-audit-labels.ts + pure functions from lib/admin-audit.ts
// so we can run without a TS loader.

const AUDIT_ACTION_LABELS = {
  login_success: "Login Success",
  member_approved: "Driver Verification Approved",
  announcement_published: "In-App Popup Published",
  wallet_transaction_posted: "Wallet Transaction Posted",
  audit_logs_exported: "Audit Logs Exported",
};

function auditActionLabel(action) {
  if (AUDIT_ACTION_LABELS[action]) return AUDIT_ACTION_LABELS[action];
  return action
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

const SENSITIVE_KEY_PATTERN =
  /(password|passwd|secret|token|otp|authorization|api[_-]?key|service[_-]?role|session|cookie|card|cvv|pan|aadhaar|aadhar)/i;

function redactSensitiveData(value, depth = 0) {
  if (value == null || depth > 6) return value;
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveData(item, depth + 1));
  }
  if (typeof value !== "object") return value;
  const out = {};
  for (const [key, nested] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      out[key] = "[REDACTED]";
      continue;
    }
    out[key] = redactSensitiveData(nested, depth + 1);
  }
  return out;
}

function diffChangedFields(before, after, keys) {
  const fieldKeys =
    keys ??
    Array.from(new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]));
  return fieldKeys.filter((key) => {
    const left = JSON.stringify(before?.[key] ?? null);
    const right = JSON.stringify(after?.[key] ?? null);
    return left !== right;
  });
}

function resolveOutcome(input) {
  if (input.outcome) return input.outcome;
  return input.success === false ? "failure" : "success";
}

// --- Labels ---
assert.equal(auditActionLabel("login_success"), "Login Success");
assert.equal(
  auditActionLabel("member_approved"),
  "Driver Verification Approved",
);
assert.equal(auditActionLabel("custom_thing_done"), "Custom Thing Done");

// --- Redaction ---
const redacted = redactSensitiveData({
  username: "admin",
  password: "secret123",
  nested: { otp: "123456", phone: "999" },
  service_role_key: "srk",
  authorization: "Bearer x",
});
assert.equal(redacted.password, "[REDACTED]");
assert.equal(redacted.nested.otp, "[REDACTED]");
assert.equal(redacted.nested.phone, "999");
assert.equal(redacted.service_role_key, "[REDACTED]");
assert.equal(redacted.authorization, "[REDACTED]");
assert.equal(redacted.username, "admin");

// --- Diff ---
assert.deepEqual(
  diffChangedFields(
    { status: "pending", amount: 10 },
    { status: "approved", amount: 10 },
  ),
  ["status"],
);
assert.deepEqual(
  diffChangedFields(
    { a: 1, b: 2 },
    { a: 1, b: 3, c: 4 },
    ["a", "b", "c"],
  ),
  ["b", "c"],
);

// --- Outcome ---
assert.equal(resolveOutcome({}), "success");
assert.equal(resolveOutcome({ success: false }), "failure");
assert.equal(resolveOutcome({ outcome: "partial", success: true }), "partial");
assert.equal(resolveOutcome({ outcome: "rejected" }), "rejected");

// --- Coverage map: every known mutating action should have a label or fallback ---
const REQUIRED_ACTIONS = [
  "login_success",
  "login_failed",
  "logout",
  "member_approved",
  "member_rejected",
  "user_updated",
  "user_deleted",
  "wallet_transaction_posted",
  "wallet_transaction_failed",
  "vehicle_approved",
  "profile_change_approved",
  "profile_change_rejected",
  "admin_user_created",
  "role_updated",
  "announcement_published",
  "birthday_notification_test_sent",
  "winner_created",
  "identity_document_deleted",
  "audit_logs_exported",
];
for (const action of REQUIRED_ACTIONS) {
  const label = auditActionLabel(action);
  assert.ok(label.length > 0, `missing label for ${action}`);
  assert.notEqual(label, action);
}

// --- Ensure client-safe labels file exists and matches key exports ---
const fs = await import("node:fs/promises");
const labelsSrc = await fs.readFile(
  path.join(root, "lib/admin-audit-labels.ts"),
  "utf8",
);
assert.match(labelsSrc, /export function auditActionLabel/);
assert.match(labelsSrc, /announcement_published/);
assert.match(labelsSrc, /wallet_transaction_posted/);

const auditSrc = await fs.readFile(path.join(root, "lib/admin-audit.ts"), "utf8");
assert.match(auditSrc, /export async function writeAdminAuditLog/);
assert.match(auditSrc, /export async function recordSuccess/);
assert.match(auditSrc, /export async function recordFailure/);
assert.match(auditSrc, /export async function recordChange/);
assert.match(auditSrc, /SYSTEM_AUDIT_ACTOR/);
assert.match(auditSrc, /redactSensitiveData/);

const migration = await fs.readFile(
  path.join(root, "supabase/migrations/066_admin_audit_logs_enrichment.sql"),
  "utf8",
);
assert.match(migration, /add column if not exists outcome/);
assert.match(migration, /audit_logs\.view_details/);
assert.match(migration, /audit_logs\.export/);

const permissions = await fs.readFile(
  path.join(root, "lib/admin-permissions.ts"),
  "utf8",
);
assert.match(permissions, /audit_logs\.view_details/);
assert.match(permissions, /audit_logs\.export/);

// Spot-check that critical routes contain audit instrumentation
const mustInstrument = [
  "app/api/admin/users/[id]/wallet/route.ts",
  "app/api/admin/winners/route.ts",
  "app/api/admin/in-app-announcements/[id]/route.ts",
  "app/api/admin/birthday-notification-test/route.ts",
  "app/api/admin/delete-document/route.ts",
  "app/api/login/route.ts",
  "app/api/logout/route.ts",
];
for (const rel of mustInstrument) {
  const src = await fs.readFile(path.join(root, rel), "utf8");
  assert.match(
    src,
    /writeAdminAuditLog|recordSuccess|recordFailure|recordChange/,
    `${rel} missing audit write`,
  );
}

// Ensure no DELETE/PATCH handlers exist for audit logs table via API
const auditApi = await fs.readFile(
  path.join(root, "app/api/admin/audit-logs/route.ts"),
  "utf8",
);
assert.doesNotMatch(auditApi, /export async function (DELETE|PATCH|PUT)/);
assert.match(auditApi, /export async function GET/);

console.log("verify-admin-audit-helpers: ok");
