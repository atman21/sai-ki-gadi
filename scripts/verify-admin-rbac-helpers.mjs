/**
 * Lightweight offline checks for admin password hashing + session signing.
 * Run: node scripts/verify-admin-rbac-helpers.mjs
 */
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

function hashAdminPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

function verifyAdminPassword(password, stored) {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "base64url");
  const expected = Buffer.from(parts[2], "base64url");
  const actual = scryptSync(password, salt, expected.length);
  return timingSafeEqual(actual, expected);
}

const secret = "test-secret";
function createSession(payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function parseSession(value) {
  const [payload, sig] = value.split(".");
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (data.exp < Date.now()) return null;
  return data;
}

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    failed += 1;
  } else {
    console.log("OK:", msg);
  }
}

const hashed = hashAdminPassword("SecretPass1");
assert(verifyAdminPassword("SecretPass1", hashed), "password verifies");
assert(!verifyAdminPassword("wrong", hashed), "wrong password rejected");

const session = createSession({
  role: "admin",
  adminId: "11111111-1111-1111-1111-111111111111",
  username: "root",
  isSuperAdmin: true,
  exp: Date.now() + 60_000,
});
const parsed = parseSession(session);
assert(parsed?.username === "root", "session username");
assert(parsed?.isSuperAdmin === true, "session super admin flag");

const expired = createSession({
  role: "admin",
  username: "root",
  exp: Date.now() - 1000,
});
assert(parseSession(expired) == null, "expired session rejected");

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nAll helper checks passed.");
