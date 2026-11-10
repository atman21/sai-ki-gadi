/**
 * T27 — Admin Date of Birth standardization (static checks).
 * Canonical source: public.users.birth_date
 * Run: node scripts/verify-dob-canonical-t27.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const tabs = read("app/dashboard/dashboard-tabs.tsx");
const page = read("app/dashboard/page.tsx");
const profile = read("app/dashboard/components/admin-user-profile-sections.tsx");
const birthApi = read("app/api/admin/users/[id]/birth-date/route.ts");
const birthdaySql = read("supabase/migrations/051_birthday_notifications.sql");
const birthdayEdge = read(
  "supabase/functions/send-birthday-notification/index.ts",
);

// Listing: single Date of Birth header; no Birth Date duplicate header.
const dobHeaders = [...tabs.matchAll(/>\s*Date of Birth\s*</g)];
const birthDateHeaders = [...tabs.matchAll(/>\s*Birth Date\s*</g)];
assert.ok(dobHeaders.length >= 1, "Date of Birth label must appear");
assert.equal(
  birthDateHeaders.length,
  0,
  "duplicate Birth Date table header must be removed",
);

// Active users table must not render date_of_birth cells.
assert.doesNotMatch(tabs, /user\.date_of_birth/);
assert.doesNotMatch(tabs, /date_of_birth:/);

// CSV export: one DOB column bound to birth_date (with optional override).
assert.match(
  tabs,
  /"Date of Birth":\s*formatBirthDateCell\(\s*(?:dobOverrides\[user\.id\]\s*\?\?\s*)?user\.birth_date/,
);
assert.doesNotMatch(tabs, /"Birth Date":\s*formatBirthDateCell/);

// Page select / mapping: birth_date only.
assert.match(page, /birth_date/);
assert.doesNotMatch(page, /date_of_birth/);

// User detail profile: one Date of Birth from birth_date.
assert.match(profile, /label="Date of Birth"/);
assert.doesNotMatch(profile, /label="Birth Date"/);
assert.match(
  profile,
  /label="Date of Birth"[\s\S]*?formatDateOnly\(user\.birth_date\)/,
);
assert.doesNotMatch(profile, /user\.date_of_birth/);
assert.doesNotMatch(profile, /"date_of_birth"/);
assert.match(profile, /"birth_date"/);

// Admin DOB API still writes canonical column.
assert.match(birthApi, /birth_date:\s*body\.birth_date/);
assert.doesNotMatch(birthApi, /date_of_birth/);

// Birthday notification still uses birth_date (unchanged).
assert.match(birthdaySql, /u\.birth_date is not null/);
assert.match(birthdaySql, /list_users_with_birthday_on/);
assert.match(birthdayEdge, /list_users_with_birthday_on/);
assert.doesNotMatch(birthdaySql, /date_of_birth/);
assert.doesNotMatch(birthdayEdge, /date_of_birth/);

console.log("T27 DOB canonicalization checks passed.");
