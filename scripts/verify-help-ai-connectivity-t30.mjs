/**
 * T30 static checks for Admin connectivity verify route (no network, no secrets).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const route = path.join(
  root,
  "app/api/admin/help-ai/settings/verify-connectivity/route.ts",
);
const panel = path.join(root, "app/dashboard/components/help-ai-panel.tsx");
const labels = path.join(root, "lib/admin-audit-labels.ts");

assert.ok(fs.existsSync(route), "verify-connectivity route missing");
const src = fs.readFileSync(route, "utf8");
assert.match(src, /help_ai\.manage/);
assert.match(src, /mnbwcwaxfywwkaxiwndo/);
assert.match(src, /verify-skg-ai-gemini-connectivity/);
assert.match(src, /voice_connectivity_verified_at/);
assert.match(src, /help_ai\.voice_connectivity\.verify/);
assert.doesNotMatch(src, /voice_enabled\s*:\s*true/);
assert.match(src, /Never sets voice_enabled|never touch voice_enabled|voice_enabled intentionally|Explicitly never touch voice_enabled/i);

const panelSrc = fs.readFileSync(panel, "utf8");
assert.match(panelSrc, /verify-connectivity/);
assert.match(panelSrc, /does NOT enable voice/i);

const labelSrc = fs.readFileSync(labels, "utf8");
assert.match(labelSrc, /help_ai\.voice_connectivity\.verify/);

console.log("T30 admin connectivity verify static checks: PASS");
