/**
 * Lightweight regression checks for admin helper logic (no test runner dep).
 * Run: node scripts/verify-admin-feature-helpers.mjs
 */

import assert from "node:assert/strict";

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

console.log("verify-admin-feature-helpers: OK");
