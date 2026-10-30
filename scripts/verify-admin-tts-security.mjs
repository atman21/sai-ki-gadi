/**
 * Runtime checks for Admin TTS hardening.
 * Run: node scripts/verify-admin-tts-security.mjs
 *
 * Loads production helpers from lib/admin-tts.ts via TypeScript.transpileModule
 * (typescript is already a project devDependency — no extra packages).
 * Filesystem mutation tests use temporary directories only.
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

async function loadProductionAdminTts() {
  const sourcePath = path.join(root, "lib", "admin-tts.ts");
  const source = fs.readFileSync(sourcePath, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      skipLibCheck: true,
    },
    fileName: "admin-tts.ts",
  });
  if (!outputText || !outputText.includes("validateTtsRequestBody")) {
    throw new Error("Failed to transpile lib/admin-tts.ts into usable ESM");
  }
  const tmpFile = path.join(
    os.tmpdir(),
    `skg-admin-tts-prod-${process.pid}-${Date.now()}.mjs`,
  );
  fs.writeFileSync(tmpFile, outputText, "utf8");
  try {
    return await import(pathToFileURL(tmpFile).href);
  } finally {
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      // ignore cleanup errors
    }
  }
}

const tts = await loadProductionAdminTts();

const realNotifications = path.join(root, "public", "notifications");
const beforeInventory = tts.fingerprintNotificationsInventory(realNotifications);
console.log(
  `inventory_before count=${beforeInventory.count} sha256=${beforeInventory.fingerprint}`,
);

// --- 1. Production validation ---
assert.equal(tts.validateTtsRequestBody(null).ok, false);
assert.equal(tts.validateTtsRequestBody({ text: "" }).ok, false);
assert.equal(
  tts.validateTtsRequestBody({
    text: "x".repeat(tts.TTS_MAX_TEXT_LENGTH + 1),
  }).ok,
  false,
);
assert.equal(
  tts.validateTtsRequestBody({ text: "hi", language: "fr" }).ok,
  false,
);
assert.equal(
  tts.validateTtsRequestBody({ text: "ok", filename: "x.mp3" }).ok,
  false,
);
assert.equal(
  tts.validateTtsRequestBody({ text: "ok", path: "../x" }).ok,
  false,
);
const valid = tts.validateTtsRequestBody({ text: " Hello ", language: "hi" });
assert.equal(valid.ok, true);
assert.equal(valid.text, "Hello");
assert.equal(valid.language, "hi");
assert.equal(tts.languageToBcp47("hi"), "hi-IN");

// --- 2. Production path resolution ---
assert.equal(tts.isSafeTtsFilename("../evil.mp3"), false);
assert.equal(tts.resolveNotificationsMp3Path("../../../etc/passwd.mp3").ok, false);
const safeName = tts.buildSafeTtsFilename();
assert.equal(tts.isSafeTtsFilename(safeName), true);

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "skg-tts-safe-"));
const tmpPublic = path.join(tmpBase, "public");
const tmpNotifications = path.join(tmpPublic, "notifications");
fs.mkdirSync(tmpNotifications, { recursive: true });

const resolved = tts.resolveNotificationsMp3Path(safeName, tmpBase);
assert.equal(resolved.ok, true);
assert.equal(
  resolved.absolutePath,
  path.join(tmpNotifications, safeName),
);
assert.equal(resolved.publicUrlPath, `/notifications/${safeName}`);

// --- 3–4. Exclusive write + collision (temp only) ---
const first = tts.writeNewNotificationMp3(Buffer.from("fake-mp3-a"), {
  cwd: tmpBase,
});
assert.equal(first.ok, true);
assert.equal(fs.readFileSync(first.absolutePath).toString(), "fake-mp3-a");

const collide = tts.writeMp3Exclusive(
  first.absolutePath,
  Buffer.from("OVERWRITE"),
  { cwd: tmpBase },
);
assert.equal(collide.ok, false);
assert.equal(collide.code, "EEXIST");
assert.equal(fs.readFileSync(first.absolutePath).toString(), "fake-mp3-a");

const second = tts.writeNewNotificationMp3(Buffer.from("fake-mp3-b"), {
  cwd: tmpBase,
});
assert.equal(second.ok, true);
assert.notEqual(second.filename, first.filename);
assert.equal(fs.readFileSync(first.absolutePath).toString(), "fake-mp3-a");

// --- 5. Symlink escape rejected (temp only) ---
const escapeBase = fs.mkdtempSync(path.join(os.tmpdir(), "skg-tts-escape-"));
const escapePublic = path.join(escapeBase, "public");
fs.mkdirSync(escapePublic, { recursive: true });
const outside = fs.mkdtempSync(path.join(os.tmpdir(), "skg-tts-outside-"));
const notificationsLink = path.join(escapePublic, "notifications");
let symlinkSupported = true;
try {
  fs.symlinkSync(outside, notificationsLink, "dir");
} catch (err) {
  symlinkSupported = false;
  console.log(
    `symlink test skipped (${err && err.code ? err.code : "unsupported"})`,
  );
}

if (symlinkSupported) {
  const rootCheck = tts.resolveTrustedNotificationsRoot(escapeBase);
  assert.equal(rootCheck.ok, false);
  assert.match(rootCheck.error, /Invalid notifications directory/);

  const pathCheck = tts.resolveNotificationsMp3Path(
    tts.buildSafeTtsFilename(),
    escapeBase,
  );
  assert.equal(pathCheck.ok, false);

  const writeCheck = tts.writeNewNotificationMp3(Buffer.from("nope"), {
    cwd: escapeBase,
  });
  assert.equal(writeCheck.ok, false);
  assert.equal(fs.readdirSync(outside).length, 0, "no write outside via symlink");
}

// public/ as symlink should also be rejected
const pubLinkBase = fs.mkdtempSync(path.join(os.tmpdir(), "skg-tts-publink-"));
const realPublicElsewhere = fs.mkdtempSync(
  path.join(os.tmpdir(), "skg-tts-realpub-"),
);
fs.mkdirSync(path.join(realPublicElsewhere, "notifications"), {
  recursive: true,
});
let publicSymlinkSupported = true;
try {
  fs.symlinkSync(realPublicElsewhere, path.join(pubLinkBase, "public"), "dir");
} catch (err) {
  publicSymlinkSupported = false;
  console.log(
    `public symlink test skipped (${err && err.code ? err.code : "unsupported"})`,
  );
}
if (publicSymlinkSupported) {
  const pubRoot = tts.resolveTrustedNotificationsRoot(pubLinkBase);
  assert.equal(pubRoot.ok, false);
}

// Cleanup temps (never touches project public/notifications)
fs.rmSync(tmpBase, { recursive: true, force: true });
fs.rmSync(escapeBase, { recursive: true, force: true });
fs.rmSync(outside, { recursive: true, force: true });
fs.rmSync(pubLinkBase, { recursive: true, force: true });
fs.rmSync(realPublicElsewhere, { recursive: true, force: true });

// --- Auth wiring (route uses production helpers + announcements.manage) ---
const routeSource = fs.readFileSync(
  path.join(root, "app", "api", "tts", "route.ts"),
  "utf8",
);
assert.match(
  routeSource,
  /requireAdminPermission\(\s*"announcements\.manage"/,
);
assert.ok(
  routeSource.includes('from "@/lib/admin-tts"'),
  "TTS route must import production helpers from lib/admin-tts",
);
assert.ok(
  routeSource.indexOf("requireAdminPermission") <
    routeSource.indexOf("synthesizeSpeech"),
);
assert.ok(
  routeSource.indexOf("requireAdminPermission") <
    routeSource.indexOf("writeNewNotificationMp3"),
);
assert.doesNotMatch(routeSource, /writeFileSync/);

assert.match(
  fs.readFileSync(path.join(root, "lib", "admin-rbac.ts"), "utf8"),
  /if \(actor\.isSuperAdmin\) return true;/,
);

// --- 6–7. Content-hash inventory unchanged ---
const afterInventory = tts.fingerprintNotificationsInventory(realNotifications);
assert.equal(afterInventory.count, beforeInventory.count);
assert.equal(afterInventory.fingerprint, beforeInventory.fingerprint);
assert.ok(afterInventory.count >= 1);
assert.equal(
  afterInventory.entries.length,
  afterInventory.count,
);
for (const entry of afterInventory.entries) {
  assert.match(entry.sha256, /^[a-f0-9]{64}$/);
  assert.match(entry.name, /\.mp3$/);
}

console.log(
  `inventory_after  count=${afterInventory.count} sha256=${afterInventory.fingerprint}`,
);
console.log(
  `verify-admin-tts-security: OK (production helpers loaded; symlinkSupported=${symlinkSupported})`,
);
console.log(
  "Manual QA still required for live HTTP 401/403 and authorized Google TTS.",
);
console.log(
  "Rate limit: no TTS-specific limiter; login limiter is login-only — left unchanged.",
);
