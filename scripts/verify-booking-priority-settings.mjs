/**
 * Booking priority settings used by the Admin Panel.
 * Run: node --experimental-strip-types scripts/verify-booking-priority-settings.mjs
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  PRIORITY_DURATION_ERROR,
  bookingPriorityTimeline,
  buildPrioritySettingsUpdate,
  isWholePriorityMinutes,
} from "../lib/booking-priority-settings.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

assert.equal(isWholePriorityMinutes(1), true);
assert.equal(isWholePriorityMinutes(1440), true);
assert.equal(isWholePriorityMinutes(0), false);
assert.equal(isWholePriorityMinutes(1441), false);
assert.equal(isWholePriorityMinutes(1.5), false);
assert.equal(isWholePriorityMinutes(Number.NaN), false);

const timeline = bookingPriorityTimeline(4, 3);
assert.equal(timeline.goldStartsAtMinute, 4);
assert.equal(timeline.everyoneStartsAtMinute, 7);
assert.equal(timeline.goldStartsAtMinute, timeline.diamondMinutes);
assert.equal(
  timeline.everyoneStartsAtMinute,
  timeline.diamondMinutes + timeline.goldMinutes,
);

const saved = buildPrioritySettingsUpdate({
  diamondMinutes: 6,
  goldMinutes: 2,
  existingLegacySilverMinutes: 9,
});
assert.equal(saved.ok, true);
if (saved.ok) {
  assert.deepEqual(saved.row, {
    all_platinum_minutes: 6,
    all_gold_minutes: 2,
    matching_platinum_minutes: 9,
  });
}

const rejected = buildPrioritySettingsUpdate({
  diamondMinutes: 0,
  goldMinutes: 3,
  existingLegacySilverMinutes: 9,
});
assert.deepEqual(rejected, { ok: false, error: PRIORITY_DURATION_ERROR });

const route = fs.readFileSync(
  path.join(root, "app/api/admin/priority-settings/route.ts"),
  "utf8",
);
assert.match(route, /buildPrioritySettingsUpdate/);
assert.match(route, /\.eq\("id", 1\)/);
assert.match(
  route,
  /existingLegacySilverMinutes: existing\.matching_platinum_minutes/,
);
assert.match(
  route,
  /matching_platinum_minutes: update\.row\.matching_platinum_minutes/,
);
assert.doesNotMatch(route, /body\.matching_platinum_minutes/);
assert.match(route, /from\("requirement_priority_settings"\)/);

const dashboard = fs.readFileSync(
  path.join(root, "app/dashboard/dashboard-tabs.tsx"),
  "utf8",
);
assert.match(dashboard, /bookingPriorityTimeline/);
assert.match(dashboard, /Before \{timeline\.goldStartsAtMinute\} min → Diamond/);
assert.match(dashboard, /At \{timeline\.everyoneStartsAtMinute\} min → Everyone/);
const silverInput = dashboard.slice(
  dashboard.indexOf("Silver priority duration"),
  dashboard.indexOf("Preview timeline"),
);
assert.match(silverInput, /disabled/);
assert.doesNotMatch(silverInput, /onChange/);

const page = fs.readFileSync(
  path.join(root, "app/dashboard/page.tsx"),
  "utf8",
);
assert.match(page, /from\("requirement_priority_settings"\)/);
assert.match(page, /matching_platinum_minutes/);
assert.match(page, /all_platinum_minutes/);
assert.match(page, /all_gold_minutes/);

console.log("booking priority settings checks passed");
