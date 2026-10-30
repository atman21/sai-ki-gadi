/**
 * Lightweight regression checks for admin helper logic (no test runner dep).
 * Run: node scripts/verify-admin-feature-helpers.mjs
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readRepoFile(...parts) {
  return fs.readFileSync(path.join(root, ...parts), "utf8");
}

function normalizeWalletAmount(value) {
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (Math.abs(amount - Number(amount.toFixed(2))) > 1e-9) return null;
  return amount;
}

function getMembershipLifecycleStatus(user, now = Date.now()) {
  if (!user.membership_type || user.membership_type === "regular") {
    return "Not Subscribed";
  }
  const expiry = user.membership_expires_at
    ? Date.parse(user.membership_expires_at)
    : Number.NaN;
  const start = user.membership_started_at
    ? Date.parse(user.membership_started_at)
    : Number.NaN;
  if (!Number.isFinite(expiry)) return "Expired";
  if (Number.isFinite(start) && start > now) return "Expired";
  return expiry > now ? "Active" : "Expired";
}

function countAssignments(rows, field) {
  const map = new Map();
  for (const row of rows) {
    const id = row[field];
    if (!id) continue;
    map.set(id, (map.get(id) ?? 0) + 1);
  }
  return map;
}

const PREFIX = "admin-wallet:";

function buildWalletIdempotencyKey(userId, opaque) {
  const id = userId.trim();
  const suffix =
    (opaque && opaque.trim()) ||
    `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${PREFIX}${id}:${suffix}`;
}

function scopeWalletIdempotencyKey(userId, clientKey) {
  const id = userId.trim();
  const raw = clientKey.trim();
  if (!id || !raw || raw.length > 200) return null;

  const expectedPrefix = `${PREFIX}${id}:`;
  if (raw.startsWith(expectedPrefix) && raw.length > expectedPrefix.length) {
    return raw.slice(0, 200);
  }

  const opaque = raw.startsWith(PREFIX)
    ? raw.slice(PREFIX.length).replace(/^[^:]+:/, "") || raw
    : raw;
  const scoped = buildWalletIdempotencyKey(id, opaque);
  return scoped.length <= 200 ? scoped : scoped.slice(0, 200);
}

// Wallet amount validation
assert.equal(normalizeWalletAmount(100), 100);
assert.equal(normalizeWalletAmount("12.50"), 12.5);
assert.equal(normalizeWalletAmount(0), null);
assert.equal(normalizeWalletAmount(-5), null);
assert.equal(normalizeWalletAmount("12.345"), null);
assert.equal(normalizeWalletAmount("abc"), null);

// Membership lifecycle independent of account status field
assert.equal(
  getMembershipLifecycleStatus({
    membership_type: "regular",
    membership_started_at: null,
    membership_expires_at: null,
  }),
  "Not Subscribed",
);
assert.equal(
  getMembershipLifecycleStatus(
    {
      membership_type: "gold",
      membership_started_at: "2020-01-01T00:00:00.000Z",
      membership_expires_at: "2099-01-01T00:00:00.000Z",
    },
    Date.parse("2026-01-01T00:00:00.000Z"),
  ),
  "Active",
);
assert.equal(
  getMembershipLifecycleStatus(
    {
      membership_type: "gold",
      membership_started_at: "2020-01-01T00:00:00.000Z",
      membership_expires_at: "2021-01-01T00:00:00.000Z",
    },
    Date.parse("2026-01-01T00:00:00.000Z"),
  ),
  "Expired",
);

// Trip assignment counting: assigned TO vs posted BY
const rows = [
  { user_id: "poster-a", assigned_id: "assignee-b" },
  { user_id: "poster-a", assigned_id: "assignee-c" },
  { user_id: "poster-b", assigned_id: "assignee-b" },
];
const byPoster = countAssignments(rows, "user_id");
const byAssignee = countAssignments(rows, "assigned_id");
assert.equal(byPoster.get("poster-a"), 2);
assert.equal(byAssignee.get("assignee-b"), 2);
assert.equal(byAssignee.get("poster-a"), undefined);

// Wallet idempotency must be user-scoped (cannot reuse another user's key)
const userA = "11111111-1111-1111-1111-111111111111";
const userB = "22222222-2222-2222-2222-222222222222";
const keyA = buildWalletIdempotencyKey(userA, "same-opaque");
const reboundFromA = scopeWalletIdempotencyKey(userB, keyA);
assert.ok(keyA.startsWith(`admin-wallet:${userA}:`));
assert.ok(reboundFromA.startsWith(`admin-wallet:${userB}:`));
assert.notEqual(keyA, reboundFromA);
assert.equal(
  scopeWalletIdempotencyKey(userA, keyA),
  keyA,
);
assert.equal(scopeWalletIdempotencyKey(userA, ""), null);
assert.equal(scopeWalletIdempotencyKey("", "x"), null);

// Unscoped client key is rebound to the path user
const scoped = scopeWalletIdempotencyKey(userA, "admin-wallet-legacy-uuid");
assert.ok(scoped.startsWith(`admin-wallet:${userA}:`));

// --- members.wallet API + dashboard gates (S0 wallet permission) ---
const walletRoute = readRepoFile(
  "app",
  "api",
  "admin",
  "users",
  "[id]",
  "wallet",
  "route.ts",
);
assert.equal(
  walletRoute.includes('requireAdminApi('),
  false,
  "wallet route must not use requireAdminApi alone",
);
assert.match(
  walletRoute,
  /requireAdminPermission\(\s*"members\.wallet"/,
  "wallet GET/POST must require members.wallet",
);
const walletPermissionGates = [
  ...walletRoute.matchAll(
    /requireAdminPermission\(\s*"members\.wallet"/g,
  ),
];
assert.equal(
  walletPermissionGates.length,
  2,
  "members.wallet must gate both GET and POST",
);
assert.match(
  walletRoute,
  /auditModule:\s*"wallet"/,
  "wallet permission denials must audit under wallet module",
);
assert.match(
  walletRoute,
  /scopeWalletIdempotencyKey/,
  "idempotency scoping helper must remain in use",
);

const adminApi = readRepoFile("lib", "admin-api.ts");
assert.match(
  adminApi,
  /\{\s*ok:\s*false,\s*error:\s*"Forbidden — insufficient permissions\."\s*\}/,
  "forbidden JSON body must stay exact for permission denials",
);
assert.match(
  adminApi,
  /status:\s*403/,
  "permission denials must return HTTP 403",
);
assert.match(
  adminApi,
  /action:\s*"permission_denied"/,
  "denied attempts must be audited when requireAdminPermission fails",
);

const rbac = readRepoFile("lib", "admin-rbac.ts");
assert.match(
  rbac,
  /if \(actor\.isSuperAdmin\) return true;/,
  "Super Admin must retain all-permission bypass",
);

const userDetailPage = readRepoFile(
  "app",
  "dashboard",
  "users",
  "[id]",
  "page.tsx",
);
assert.match(
  userDetailPage,
  /actorHasPermission\(actor,\s*"members\.wallet"\)/,
  "user detail must resolve members.wallet for the current actor",
);
assert.match(
  userDetailPage,
  /canManageWallet\s*\?\s*<AdminWalletPanel[\s\S]*:\s*null/,
  "wallet panel must render only when members.wallet is granted",
);
assert.equal(
  /<AdminWalletPanel\s+userId=\{id\}\s*\/>/.test(userDetailPage) &&
    !userDetailPage.includes("canManageWallet ?"),
  false,
  "AdminWalletPanel must not render unconditionally",
);

const permissions = readRepoFile("lib", "admin-permissions.ts");
assert.match(
  permissions,
  /"wallet-management":\s*"members\.wallet"/,
  "TAB_PERMISSION_MAP wallet-management must stay members.wallet",
);

console.log("verify-admin-feature-helpers: OK");
