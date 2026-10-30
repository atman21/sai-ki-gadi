/**
 * Auth + secrets hardening checks against production helpers.
 * Run: node scripts/verify-admin-auth-secrets.mjs
 *
 * Loads lib/admin-auth.ts and lib/admin-password.ts via typescript.transpileModule
 * (existing project dependency — no new packages). Does not read real .env files
 * or print secret values.
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
    `skg-auth-${path.basename(relativePath)}-${process.pid}-${Date.now()}.mjs`,
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

const auth = await loadTsModule("lib/admin-auth.ts");
const passwords = await loadTsModule("lib/admin-password.ts");

const STRONG_SECRET = `unit-test-admin-session-secret-${"x".repeat(16)}`;
assert.ok(STRONG_SECRET.length >= auth.MIN_ADMIN_SESSION_SECRET_LENGTH);

const saved = {
  NODE_ENV: process.env.NODE_ENV,
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
  ADMIN_SESSION_SECRET: process.env.ADMIN_SESSION_SECRET,
  ADMIN_USERNAME: process.env.ADMIN_USERNAME,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function withEnv(overrides, fn) {
  const previous = {};
  for (const key of Object.keys(overrides)) {
    previous[key] = process.env[key];
    const next = overrides[key];
    if (next === undefined) delete process.env[key];
    else process.env[key] = next;
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(overrides)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

try {
  // --- Source: hardcoded password/session defaults removed from active path ---
  const authSource = fs.readFileSync(path.join(root, "lib", "admin-auth.ts"), "utf8");
  assert.equal(authSource.includes('?? "12345678"'), false);
  assert.equal(authSource.includes('|| "12345678"'), false);
  assert.equal(
    authSource.includes('||\n    "merigaadi-dev-session-secret-change-me"'),
    false,
  );
  assert.equal(
    /ADMIN_PASSWORD\s*\?\?/.test(authSource) &&
      authSource.includes('"12345678"') &&
      /getAdminPassword[\s\S]*12345678/.test(authSource),
    false,
  );
  assert.equal(auth.usesHardcodedPasswordFallback(), false);
  // Banned legacy strings may appear only in the reject-list, never as fallbacks.
  assert.ok(
    auth.INSECURE_SESSION_SECRET_VALUES.includes(
      "merigaadi-dev-session-secret-change-me",
    ),
  );
  assert.ok(auth.INSECURE_SESSION_SECRET_VALUES.includes("12345678"));

  // --- Password missing / empty (production-safe getters) ---
  withEnv({ ADMIN_PASSWORD: undefined }, () => {
    assert.equal(auth.getAdminPassword(), null);
  });
  withEnv({ ADMIN_PASSWORD: "" }, () => {
    assert.equal(auth.getAdminPassword(), null);
  });
  withEnv({ ADMIN_PASSWORD: "LocalOnlyPassphrase!99" }, () => {
    assert.equal(auth.getAdminPassword(), "LocalOnlyPassphrase!99");
  });

  // Env bootstrap path: missing password cannot authenticate via env
  // (unit-level: getter null — rbac requires envPass != null)
  const rbacSource = fs.readFileSync(path.join(root, "lib", "admin-rbac.ts"), "utf8");
  assert.match(rbacSource, /envPass != null/);
  assert.match(rbacSource, /getAdminPassword\(\)/);

  // --- NODE_ENV isolation: local fallback ONLY for development ---
  assert.equal(auth.isDevelopmentRuntime("development"), true);
  assert.equal(auth.isDevelopmentRuntime("production"), false);
  assert.equal(auth.isDevelopmentRuntime("test"), false);
  assert.equal(auth.isDevelopmentRuntime("staging"), false);
  assert.equal(auth.isDevelopmentRuntime(undefined), false);
  assert.equal(auth.isDevelopmentRuntime(""), false);
  assert.equal(auth.isDevelopmentRuntime("weird"), false);

  // 1) development + no secret → local-only fallback
  const local = auth.resolveAdminSessionSecret({
    NODE_ENV: "development",
  });
  assert.equal(local.ok, true);
  assert.equal(local.source, "local_dev_fallback");
  assert.ok(local.secret.length >= auth.MIN_ADMIN_SESSION_SECRET_LENGTH);

  // development + empty secret string → fail closed (not fallback)
  assert.equal(
    auth.resolveAdminSessionSecret({
      NODE_ENV: "development",
      ADMIN_SESSION_SECRET: "",
    }).reason,
    "empty",
  );

  // 2–7) non-development without secret → fail closed
  for (const nodeEnv of [
    "production",
    "test",
    "staging",
    undefined,
    "",
    "ci",
    "preview",
  ]) {
    const result = auth.resolveAdminSessionSecret(
      nodeEnv === undefined
        ? {}
        : { NODE_ENV: nodeEnv },
    );
    assert.equal(
      result.ok,
      false,
      `expected fail closed for NODE_ENV=${String(nodeEnv)}`,
    );
    assert.equal(result.reason, "missing");
  }

  // 8) non-development with valid explicit secret → accepted
  for (const nodeEnv of ["production", "test", "staging", "ci", ""]) {
    const result = auth.resolveAdminSessionSecret({
      NODE_ENV: nodeEnv,
      ADMIN_SESSION_SECRET: STRONG_SECRET,
    });
    assert.equal(result.ok, true, `expected accept for NODE_ENV=${nodeEnv}`);
    assert.equal(result.source, "env");
    assert.equal(result.secret, STRONG_SECRET);
  }
  // undefined NODE_ENV with valid secret
  assert.equal(
    auth.resolveAdminSessionSecret({
      ADMIN_SESSION_SECRET: STRONG_SECRET,
    }).ok,
    true,
  );

  // 9) known insecure values rejected (any env)
  assert.equal(
    auth.resolveAdminSessionSecret({
      NODE_ENV: "production",
      ADMIN_SESSION_SECRET: "merigaadi-dev-session-secret-change-me",
    }).reason,
    "insecure",
  );
  assert.equal(
    auth.resolveAdminSessionSecret({
      NODE_ENV: "development",
      ADMIN_SESSION_SECRET: "merigaadi-dev-session-secret-change-me",
    }).reason,
    "insecure",
  );
  assert.equal(
    auth.resolveAdminSessionSecret({
      NODE_ENV: "production",
      ADMIN_SESSION_SECRET: local.secret,
    }).reason,
    "insecure",
  );
  assert.equal(
    auth.resolveAdminSessionSecret({
      NODE_ENV: "production",
      ADMIN_SESSION_SECRET: "short-secret",
    }).reason,
    "too_short",
  );
  assert.equal(
    auth.resolveAdminSessionSecret({
      NODE_ENV: "production",
      ADMIN_SESSION_SECRET: "",
    }).reason,
    "empty",
  );
  // ADMIN_PASSWORD must never substitute for session secret
  assert.equal(
    auth.resolveAdminSessionSecret({
      NODE_ENV: "production",
      ADMIN_PASSWORD: STRONG_SECRET,
    }).ok,
    false,
  );

  // 10) error messages must not include secret material
  withEnv(
    {
      NODE_ENV: "production",
      ADMIN_SESSION_SECRET: undefined,
    },
    () => {
      assert.equal(auth.parseAdminSessionValue("a.b"), null);
      let thrown;
      try {
        auth.createAdminSessionValue({ username: "x" });
      } catch (err) {
        thrown = err;
      }
      assert.ok(thrown);
      assert.equal(thrown.name, "AdminAuthConfigError");
      assert.equal(thrown.message, "Server authentication is not configured.");
      assert.equal(String(thrown.message).includes(STRONG_SECRET), false);
      assert.equal(
        String(thrown.message).includes("merigaadi-dev-session-secret"),
        false,
      );
    },
  );

  const loginSource = fs.readFileSync(
    path.join(root, "app", "api", "login", "route.ts"),
    "utf8",
  );
  assert.match(loginSource, /Server authentication is not configured\./);
  assert.match(loginSource, /status: 503/);
  assert.equal(loginSource.includes("ADMIN_SESSION_SECRET"), false);
  assert.equal(loginSource.includes("stack"), false);

  // --- Session create/validate compatibility (explicit secret required for test) ---
  withEnv(
    {
      NODE_ENV: "test",
      ADMIN_SESSION_SECRET: STRONG_SECRET,
      ADMIN_USERNAME: "admin",
    },
    () => {
      const token = auth.createAdminSessionValue({
        adminId: "11111111-1111-1111-1111-111111111111",
        username: "root",
        displayName: "Root",
        isSuperAdmin: true,
      });
      const parsed = auth.parseAdminSessionValue(token);
      assert.ok(parsed);
      assert.equal(parsed.username, "root");
      assert.equal(parsed.isSuperAdmin, true);
      assert.equal(parsed.adminId, "11111111-1111-1111-1111-111111111111");
      assert.equal(auth.isValidAdminSessionValue(token), true);
      assert.equal(auth.isValidAdminSessionValue("tampered." + token), false);
    },
  );

  // --- Password hashing compatibility (production helper) ---
  const hashed = passwords.hashAdminPassword("SecretPass1!");
  assert.equal(passwords.verifyAdminPassword("SecretPass1!", hashed), true);
  assert.equal(passwords.verifyAdminPassword("wrong", hashed), false);

  // --- RBAC not weakened: Super Admin bypass still present ---
  assert.match(
    fs.readFileSync(path.join(root, "lib", "admin-rbac.ts"), "utf8"),
    /if \(actor\.isSuperAdmin\) return true;/,
  );
  assert.match(
    fs.readFileSync(path.join(root, "app", "api", "login", "route.ts"), "utf8"),
    /AdminAuthConfigError/,
  );

  console.log("verify-admin-auth-secrets: OK");
} finally {
  restoreEnv();
}
