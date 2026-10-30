/**
 * Supabase service-role exposure checks.
 * Run: node scripts/verify-admin-supabase-secrets.mjs
 *
 * Uses production helpers from lib/supabase-service-role-config.ts via
 * typescript.transpileModule. Never prints secret values. Does not connect
 * to Supabase or read .env.local values into output.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const ts = require("typescript");

async function loadTsModule(relativePath) {
  const sourcePath = path.join(root, relativePath);
  const source = fs.readFileSync(sourcePath, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      skipLibCheck: true,
    },
    fileName: path.basename(relativePath),
  });
  const tmp = path.join(
    os.tmpdir(),
    `skg-supabase-${path.basename(relativePath)}-${process.pid}-${Date.now()}.mjs`,
  );
  fs.writeFileSync(tmp, outputText, "utf8");
  try {
    return await import(pathToFileURL(tmp).href);
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // ignore
    }
  }
}

const cfg = await loadTsModule("lib/supabase-service-role-config.ts");

const FAKE_SERVICE =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
  Buffer.from(
    JSON.stringify({
      role: "service_role",
      ref: "test",
    }),
  )
    .toString("base64url")
    .replace(/=+$/, "") +
  ".sig";
const FAKE_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
  Buffer.from(JSON.stringify({ role: "anon", ref: "test" }))
    .toString("base64url")
    .replace(/=+$/, "") +
  ".sig";

assert.equal(cfg.publicServiceRoleEnvName(), "NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY");
assert.equal(cfg.SERVER_SERVICE_ROLE_ENV_NAME, "SUPABASE_SERVICE_ROLE_KEY");
assert.equal(cfg.looksLikeServiceRoleKey(FAKE_SERVICE), true);
assert.equal(cfg.looksLikePublishableOrAnonKey(FAKE_ANON), true);
assert.equal(cfg.looksLikeServiceRoleKey(FAKE_ANON), false);

// 1–2) Server-side init config: missing key fails safely
const missing = cfg.resolveServiceRoleConfig({
  NODE_ENV: "production",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: FAKE_ANON,
});
assert.equal(missing.usingServiceRole, false);
assert.ok(missing.issue);
assert.equal(missing.issue.includes(FAKE_SERVICE), false);
assert.equal(missing.issue.includes(FAKE_ANON), false);

// Valid server-only key
const ok = cfg.resolveServiceRoleConfig({
  NODE_ENV: "production",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: FAKE_ANON,
  SUPABASE_SERVICE_ROLE_KEY: FAKE_SERVICE,
});
assert.equal(ok.usingServiceRole, true);
assert.equal(ok.issue, null);
assert.equal(cfg.getServerServiceRoleKey({
  SUPABASE_SERVICE_ROLE_KEY: FAKE_SERVICE,
  NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY: FAKE_ANON,
}), FAKE_SERVICE);

// 3) Public env var is never used as active credential (no silent fallback)
const publicOnly = cfg.resolveServiceRoleConfig({
  NODE_ENV: "production",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: FAKE_ANON,
  NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY: FAKE_SERVICE,
});
assert.equal(publicOnly.publicKeyNamePresent, true);
assert.equal(publicOnly.usingServiceRole, false);
assert.match(publicOnly.issue, /Remove NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY/);
assert.equal(
  cfg.getServerServiceRoleKey({
    NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY: FAKE_SERVICE,
  }),
  "",
);

// Both set: server key still wins; public presence is reported as an issue
const leakedBoth = cfg.resolveServiceRoleConfig({
  NODE_ENV: "production",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: FAKE_ANON,
  SUPABASE_SERVICE_ROLE_KEY: FAKE_SERVICE,
  NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY: FAKE_SERVICE,
});
assert.equal(leakedBoth.publicKeyNamePresent, true);
assert.equal(leakedBoth.usingServiceRole, true);
assert.match(leakedBoth.issue, /Remove NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY/);

// Anon key mis-set as service role
const anonAsService = cfg.resolveServiceRoleConfig({
  NODE_ENV: "production",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: FAKE_ANON,
  SUPABASE_SERVICE_ROLE_KEY: FAKE_ANON,
});
assert.equal(anonAsService.usingServiceRole, false);
assert.ok(anonAsService.issue);
assert.equal(anonAsService.issue.includes(FAKE_ANON), false);

// Invalid / garbage service-role value fails safely (no privileged flag)
const invalidKey = cfg.resolveServiceRoleConfig({
  NODE_ENV: "production",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: FAKE_ANON,
  SUPABASE_SERVICE_ROLE_KEY: "not-a-real-key",
});
assert.equal(invalidKey.usingServiceRole, false);
assert.ok(invalidKey.issue);
assert.equal(invalidKey.issue.includes("not-a-real-key"), false);

const publishableAsService = cfg.resolveServiceRoleConfig({
  NODE_ENV: "development",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: FAKE_ANON,
  SUPABASE_SERVICE_ROLE_KEY: "sb_publishable_test_value",
});
assert.equal(publishableAsService.usingServiceRole, false);
assert.ok(publishableAsService.issue);

// Valid configuration preserves privileged readiness
assert.equal(ok.usingServiceRole, true);
assert.equal(ok.issue, null);
assert.equal(ok.publicKeyNamePresent, false);

// Shared API gate must fail closed when service role is unavailable
const adminApiSource = fs.readFileSync(
  path.join(root, "lib", "admin-api.ts"),
  "utf8",
);
assert.match(adminApiSource, /if\s*\(\s*!usingServiceRole\s*\)/);
assert.match(adminApiSource, /status:\s*503/);
assert.match(adminApiSource, /serviceRoleConfigIssue/);
assert.match(
  adminApiSource,
  /safeErrorMessage[\s\S]*permission denied\|rls\|jwt\|service\.role/i,
);

// Privileged mutation route must not bypass the shared gate (anon RLS no-op → false ok:true)
const deleteDocSource = fs.readFileSync(
  path.join(root, "app", "api", "admin", "delete-document", "route.ts"),
  "utf8",
);
assert.match(deleteDocSource, /requireAdminApi/);
assert.equal(deleteDocSource.includes("hasAdminSession"), false);
assert.equal(
  /from\s+["']@\/lib\/supabase-admin["']/.test(deleteDocSource),
  false,
  "delete-document must use gate.supabase, not a direct unguarded import",
);

// 4) Client modules must not import privileged client
function walkTsFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === ".next") continue;
      walkTsFiles(p, out);
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

const clientImporters = [];
for (const file of walkTsFiles(path.join(root, "app")).concat(
  walkTsFiles(path.join(root, "components")),
)) {
  const text = fs.readFileSync(file, "utf8");
  const isClient = /^["']use client["']/.test(text.trim()) || text.includes('\n"use client"') || text.includes("\n'use client'");
  if (!isClient) continue;
  if (
    text.includes("@/lib/supabase-admin") ||
    text.includes("lib/supabase-admin")
  ) {
    clientImporters.push(path.relative(root, file));
  }
}
assert.equal(
  clientImporters.length,
  0,
  `client components must not import supabase-admin: ${clientImporters.join(", ")}`,
);

// 5) Browser client remains anon-only
const browserSource = fs.readFileSync(
  path.join(root, "lib", "supabase-browser.ts"),
  "utf8",
);
assert.match(browserSource, /NEXT_PUBLIC_SUPABASE_ANON_KEY/);
assert.equal(browserSource.includes("SERVICE_ROLE"), false);
assert.equal(browserSource.includes("SUPABASE_SERVICE_ROLE_KEY"), false);

// Admin client source: no static NEXT_PUBLIC_SERVICE credential assignment
const adminSource = fs.readFileSync(
  path.join(root, "lib", "supabase-admin.ts"),
  "utf8",
);
assert.match(adminSource, /getServerServiceRoleKey/);
assert.match(adminSource, /resolveServiceRoleConfig/);
assert.equal(
  /createClient\([\s\S]*NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY/.test(adminSource),
  false,
);
assert.match(
  adminSource,
  /typeof window !== "undefined"/,
);

const configSource = fs.readFileSync(
  path.join(root, "lib", "supabase-service-role-config.ts"),
  "utf8",
);
assert.match(configSource, /publicServiceRoleEnvName/);
assert.equal(
  configSource.includes("process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY"),
  false,
  "config helper must not statically reference NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY",
);

// 5b / 7) Issues and safe error paths never embed provided key material
for (const issue of [
  missing.issue,
  publicOnly.issue,
  leakedBoth.issue,
  anonAsService.issue,
  invalidKey.issue,
  publishableAsService.issue,
]) {
  assert.ok(issue);
  assert.equal(issue.includes(FAKE_SERVICE), false);
  assert.equal(issue.includes(FAKE_ANON), false);
  assert.equal(issue.includes("not-a-real-key"), false);
  assert.equal(issue.includes("sb_publishable_test_value"), false);
}

// Simulate privileged-op denial payload shape (what requireAdminApi returns)
const deniedPayload = {
  ok: false,
  error:
    missing.issue ?? "Server-only SUPABASE_SERVICE_ROLE_KEY is required.",
};
assert.equal(deniedPayload.ok, false);
assert.equal(deniedPayload.error.includes(FAKE_SERVICE), false);
assert.equal(deniedPayload.error.includes(FAKE_ANON), false);
assert.match(String(deniedPayload.error), /SUPABASE_SERVICE_ROLE_KEY|Remove NEXT_PUBLIC_/);

// 8) Client build output scan (if present): look for env var NAME only, not secret values
const staticDir = path.join(root, ".next", "static");
let clientBundleMentionsPublicServiceRoleName = false;
if (fs.existsSync(staticDir)) {
  const stack = [staticDir];
  while (stack.length) {
    const dir = stack.pop();
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) stack.push(p);
      else if (/\.(js|css|map)$/.test(name)) {
        const text = fs.readFileSync(p, "utf8");
        if (text.includes("NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY")) {
          clientBundleMentionsPublicServiceRoleName = true;
        }
      }
    }
  }
}
assert.equal(
  clientBundleMentionsPublicServiceRoleName,
  false,
  ".next/static must not contain NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY name",
);

console.log("verify-admin-supabase-secrets: OK");
console.log(
  `client_bundle_scan=${fs.existsSync(staticDir) ? "ran" : "skipped_no_.next/static"}`,
);
console.log(
  "Migration note: remove NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY from local/hosting env; keep only SUPABASE_SERVICE_ROLE_KEY (server-only).",
);
