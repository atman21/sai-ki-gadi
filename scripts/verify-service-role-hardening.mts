import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  AdminSessionConfigError,
  adminSessionConfigIssue,
  createAdminSessionValue,
  getAdminPassword,
  parseAdminSessionValue,
} from "../lib/admin-auth.ts";
import {
  publicServiceRoleConfigured,
  publicServiceRoleStartupError,
} from "../lib/service-role-env.ts";

const root = path.resolve(import.meta.dirname, "..");
const PUBLIC_NAME = ["NEXT_PUBLIC", "SUPABASE_SERVICE_ROLE_KEY"].join("_");
const BLOCKED_PASSWORD = ["1234", "5678"].join("");
const BLOCKED_SECRET = ["merigaadi-dev-session-secret", "change-me"].join("-");
const SENTINEL = "sentinel-not-a-real-key";

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

test("client and server source do not statically name the public service-role env", () => {
  const files = [
    ...walk(path.join(root, "app")),
    ...walk(path.join(root, "lib")),
    ...walk(path.join(root, "components")),
  ];
  assert.ok(files.length > 0);
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    assert.equal(
      text.includes(PUBLIC_NAME),
      false,
      `${path.relative(root, file)} statically names the public service-role env`,
    );
  }

  const adminClient = fs.readFileSync(path.join(root, "lib/supabase-admin.ts"), "utf8");
  const guardAt = adminClient.indexOf("publicServiceRoleStartupError()");
  const clientAt = adminClient.indexOf("createClient(");
  assert.ok(guardAt >= 0 && clientAt > guardAt);

  const auth = fs.readFileSync(path.join(root, "lib/admin-auth.ts"), "utf8");
  assert.equal(auth.includes(BLOCKED_PASSWORD), false);
  assert.equal(auth.includes(BLOCKED_SECRET), false);
  assert.equal(auth.includes("ADMIN_PASSWORD?.trim() ||"), false);
});

test("a public-prefixed service-role value is rejected and not echoed", () => {
  const previous = process.env[PUBLIC_NAME];
  process.env[PUBLIC_NAME] = SENTINEL;
  try {
    assert.equal(publicServiceRoleConfigured(), true);
    const message = publicServiceRoleStartupError() ?? "";
    assert.match(message, /public env prefix/);
    assert.equal(message.includes(SENTINEL), false);
  } finally {
    if (previous === undefined) delete process.env[PUBLIC_NAME];
    else process.env[PUBLIC_NAME] = previous;
  }
  assert.equal(publicServiceRoleConfigured(), false);
  assert.equal(publicServiceRoleStartupError(), null);
});

test("env bootstrap password has no development default", () => {
  const previous = process.env.ADMIN_PASSWORD;
  try {
    delete process.env.ADMIN_PASSWORD;
    assert.equal(getAdminPassword(), null);
    process.env.ADMIN_PASSWORD = `  ${BLOCKED_PASSWORD}  `;
    assert.equal(getAdminPassword(), null);
    process.env.ADMIN_PASSWORD = "a-real-admin-password";
    assert.equal(getAdminPassword(), "a-real-admin-password");
  } finally {
    if (previous === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = previous;
  }
});

test("session cookies require a distinct 32-character secret", () => {
  const previousSecret = process.env.ADMIN_SESSION_SECRET;
  const previousPassword = process.env.ADMIN_PASSWORD;
  try {
    delete process.env.ADMIN_SESSION_SECRET;
    delete process.env.ADMIN_PASSWORD;
    assert.match(adminSessionConfigIssue() ?? "", /ADMIN_SESSION_SECRET/);
    assert.equal(parseAdminSessionValue("payload.sig"), null);
    assert.throws(() => createAdminSessionValue(), AdminSessionConfigError);

    process.env.ADMIN_SESSION_SECRET = BLOCKED_SECRET;
    assert.match(adminSessionConfigIssue() ?? "", /unique server-only/);

    process.env.ADMIN_SESSION_SECRET = "short-secret-value";
    assert.match(adminSessionConfigIssue() ?? "", /32 characters/);

    const shared = "s".repeat(32);
    process.env.ADMIN_PASSWORD = shared;
    process.env.ADMIN_SESSION_SECRET = shared;
    assert.match(adminSessionConfigIssue() ?? "", /different from ADMIN_PASSWORD/);

    process.env.ADMIN_PASSWORD = "a-real-admin-password";
    process.env.ADMIN_SESSION_SECRET = "t".repeat(32);
    assert.equal(adminSessionConfigIssue(), null);
    const cookie = createAdminSessionValue({
      username: "ada",
      isSuperAdmin: true,
    });
    assert.equal(parseAdminSessionValue(cookie)?.username, "ada");
    assert.equal(parseAdminSessionValue(`${cookie}x`), null);
  } finally {
    if (previousSecret === undefined) delete process.env.ADMIN_SESSION_SECRET;
    else process.env.ADMIN_SESSION_SECRET = previousSecret;
    if (previousPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = previousPassword;
  }
});
