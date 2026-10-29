import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "app/api/admin/user-fare-overrides/revoke/route.ts"), "utf8");

assert.match(source, /requireAdminPermission\("fare_overrides[.]manage"/);
assert.match(source, /if \(!gate[.]ok\) return gate[.]response/);
assert.match(source, /await gate[.]supabase[.]rpc\("revoke_user_fare_override"/);
assert.match(source, /auditModule: "fare_overrides"/);
assert.doesNotMatch(source, /requireAdminApi[(]/);
assert.match(source, /typeof rawBody === "object"/);
assert.match(source, /!Array[.]isArray[(]rawBody[)]/);
assert.match(source, /typeof body[.]overrideId === "string"/);
console.log("S0-2 fare override revoke RBAC contract checks passed.");

const announcementsSearch = fs.readFileSync(
  path.join(root, "app/api/admin/in-app-announcements/users-search/route.ts"),
  "utf8",
);
assert.match(announcementsSearch, /requireAdminPermission\("announcements[.]manage"/);
assert.match(announcementsSearch, /auditModule: "announcements"/);
assert.match(announcementsSearch, /if \(!auth[.]ok\) return auth[.]response/);
assert.doesNotMatch(announcementsSearch, /requireAdminApi[(]/);
assert.doesNotMatch(announcementsSearch, /[.]from[(]"users"[)]/);
assert.match(announcementsSearch, /Announcement user search is temporarily unavailable[.]/);
assert.match(announcementsSearch, /status: 503/);
console.log("S0-2 announcement member search RBAC contract checks passed.");
