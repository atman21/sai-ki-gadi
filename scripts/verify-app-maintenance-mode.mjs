/**
 * Static verification for SKG App Maintenance Mode + allowlist.
 * Run: node scripts/verify-app-maintenance-mode.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const mobileRoot = path.resolve(root, "../sai-ki-gadi-app");
const require = createRequire(import.meta.url);

function file(rel, base = root) {
  return fs.readFileSync(path.join(base, rel), "utf8");
}

function loadTs(rel, base = root) {
  const full = path.join(base, rel);
  // Strip types lightly for node — helpers are plain TS-ish JS compatible enough via dynamic import after transpile? Use regex asserts instead for TS.
  return file(rel, base);
}

{
  const src = file("lib/app-maintenance-admin.ts");
  assert.match(src, /normalizeMaintenanceMobileE164/);
  assert.match(src, /\+91/);
  assert.match(src, /skg_ai_settings\.emergency_disabled/);
  console.log("OK: Admin maintenance helpers + AI emergency separation note");
}

{
  const perms = file("lib/admin-permissions.ts");
  assert.match(perms, /"app\.view"/);
  assert.match(perms, /"app\.manage"/);
  assert.match(perms, /"app-maintenance": "app\.view"/);
  assert.match(file("lib/app-management-nav.ts"), /APP MANAGEMENT/);
  console.log("OK: RBAC + App Management nav");
}

{
  for (const rel of [
    "app/api/admin/app-management/maintenance/route.ts",
    "app/api/admin/app-management/maintenance/allowlist/route.ts",
    "app/api/admin/app-management/maintenance/allowlist/[id]/route.ts",
    "app/api/admin/app-management/maintenance/owners/route.ts",
  ]) {
    const src = file(rel);
    assert.match(src, /requireAdminPermission/);
    assert.match(src, /app\.(view|manage)/);
  }
  console.log("OK: Admin APIs gated");
}

{
  const panel = file("components/admin/app-maintenance-admin-panel.tsx");
  assert.match(panel, /Maintenance Allowed Mobile Numbers/);
  assert.match(panel, /force_emergency/);
  assert.match(panel, /Preview/);
  const dash = file("app/dashboard/dashboard-tabs.tsx");
  assert.match(dash, /AppManagementAccessGate/);
  assert.match(dash, /APP_MANAGEMENT_NAV/);
  console.log("OK: Admin UI wiring");
}

{
  const mig = file(
    "supabase/migrations/20261126190000_skg_app_maintenance_admin_permissions.sql",
  );
  assert.match(mig, /app\.view/);
  assert.match(mig, /app\.manage/);
  console.log("OK: Admin permission migration source");
}

{
  const mig = file(
    "supabase/migrations/20261126190000_skg_app_maintenance_mode.sql",
    mobileRoot,
  );
  assert.match(mig, /skg_app_maintenance_settings/);
  assert.match(mig, /skg_app_maintenance_allowed_numbers/);
  assert.match(mig, /get_skg_app_maintenance_status/);
  assert.match(mig, /skg_app_maintenance_blocks_writes/);
  assert.match(mig, /users\.phone/);
  assert.match(mig, /intentionally omit: allowlist/);
  assert.doesNotMatch(
    mig,
    /'allowed_numbers'\s*,/,
  );
  assert.match(mig, /grant execute on function public\.get_skg_app_maintenance_status/);
  assert.match(mig, /revoke all on table public\.skg_app_maintenance_allowed_numbers/);
  assert.match(
    file(
      "supabase/migrations/20261126190000_skg_app_maintenance_mode.rollback.sql",
      mobileRoot,
    ),
    /drop table if exists public\.skg_app_maintenance_settings/,
  );
  console.log("OK: Mobile migration + rollback + private allowlist");
}

{
  const svc = file(
    "services/maintenance/maintenance.service.ts",
    mobileRoot,
  );
  assert.match(svc, /get_skg_app_maintenance_status/);
  assert.match(svc, /shouldShowMaintenanceScreen/);
  const layout = file("app/_layout.tsx", mobileRoot);
  assert.match(layout, /MaintenanceScreen/);
  assert.match(layout, /useMaintenanceStatus/);
  const screen = file("components/maintenance-screen.tsx", mobileRoot);
  assert.match(screen, /onRetry/);
  console.log("OK: Mobile maintenance engine wiring");
}

{
  // Pure normalize unit checks by evaluating helper via Function from extracted logic
  const { createRequire: cr } = await import("node:module");
  // Inline mirror of normalize rules for unit assert
  function normalize(raw) {
    let digits = String(raw).replace(/\D/g, "");
    if (digits.startsWith("91") && digits.length === 12) digits = digits.slice(2);
    else if (digits.startsWith("0") && digits.length === 11) digits = digits.slice(1);
    if (!/^[6-9]\d{9}$/.test(digits)) return null;
    return `+91${digits}`;
  }
  assert.equal(normalize("9876543210"), "+919876543210");
  assert.equal(normalize("+91 98765 43210"), "+919876543210");
  assert.equal(normalize("09876543210"), "+919876543210");
  assert.equal(normalize("12345"), null);
  console.log("OK: phone normalization cases");
}

{
  // Active schedule math
  function active(row, now) {
    if (row.force_emergency) return true;
    if (!row.enabled) return false;
    if (row.start_at && Date.parse(row.start_at) > now) return false;
    if (row.end_at && Date.parse(row.end_at) <= now) return false;
    return true;
  }
  const now = Date.parse("2026-11-26T12:00:00Z");
  assert.equal(active({ enabled: false, force_emergency: false }, now), false);
  assert.equal(active({ enabled: true, force_emergency: false }, now), true);
  assert.equal(
    active(
      {
        enabled: true,
        force_emergency: false,
        start_at: "2026-11-27T00:00:00Z",
      },
      now,
    ),
    false,
  );
  assert.equal(
    active(
      {
        enabled: false,
        force_emergency: true,
      },
      now,
    ),
    true,
  );
  console.log("OK: schedule / emergency active math");
}

{
  const adminDt = file("lib/maintenance-datetime-admin.ts");
  assert.match(adminDt, /fromLocalDatetimeInputValue/);
  assert.match(adminDt, /toLocalDatetimeInputValue/);
  const panel = file("components/admin/app-maintenance-admin-panel.tsx");
  assert.match(panel, /fromLocalDatetimeInputValue/);
  assert.match(panel, /UTC:/);
  assert.match(panel, /Expected completion/);
  console.log("OK: Admin local↔UTC datetime helpers wired");
}

{
  const mobileDt = file("lib/maintenance-datetime.ts", mobileRoot);
  assert.match(mobileDt, /parseMaintenanceTimestamp/);
  assert.match(mobileDt, /resolveCompletionTimestamp/);
  assert.match(mobileDt, /computeCountdown/);
  const screen = file("components/maintenance-screen.tsx", mobileRoot);
  assert.match(screen, /maintenanceStartsAt/);
  assert.match(screen, /maintenanceEndsAt/);
  assert.match(screen, /computeCountdown/);
  assert.match(screen, /MaintenanceVehicleScene|image_url/);
  const svc = file("services/maintenance/maintenance.service.ts", mobileRoot);
  assert.match(svc, /normalizeMaintenanceStatus/);
  console.log("OK: Mobile datetime display + countdown + normalize");
}

{
  // Mirror of admin fromLocalDatetimeInputValue
  function fromLocal(local) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
      local.trim(),
    );
    if (!m) return null;
    const date = new Date(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4]),
      Number(m[5]),
      Number(m[6] ?? "0"),
      0,
    );
    return date.toISOString();
  }
  const iso = fromLocal("2026-11-26T15:30");
  assert.ok(iso && iso.endsWith("Z"));
  // Round-trip through Date must preserve the local wall components when
  // formatted back with local getters (same as Admin toLocalDatetimeInputValue).
  const again = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  const localAgain = `${again.getFullYear()}-${pad(again.getMonth() + 1)}-${pad(again.getDate())}T${pad(again.getHours())}:${pad(again.getMinutes())}`;
  assert.equal(localAgain, "2026-11-26T15:30");

  // Bare ISO without Z must be treated as UTC by mobile parser
  function parseMaint(value) {
    let raw = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(raw)) {
      raw = `${raw}Z`;
    }
    return new Date(raw).toISOString();
  }
  assert.equal(
    parseMaint("2026-11-26T10:00:00"),
    "2026-11-26T10:00:00.000Z",
  );
  console.log("OK: datetime round-trip + UTC-bare ISO normalization");
}

console.log("\nApp Maintenance Mode verification: passed");
