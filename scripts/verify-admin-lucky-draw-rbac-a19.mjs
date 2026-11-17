/**
 * A19.1 + A19.2 — Winners / Wallet Admin API RBAC contracts.
 * Run: npm run test:admin-lucky-draw-rbac-a19
 *
 * STATIC + UNIT only. Does not prove live HTTP/DB against a running server.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

function methodBodies(src, methodName) {
  const re = new RegExp(
    `export\\s+async\\s+function\\s+${methodName}\\s*\\([\\s\\S]*?\\)\\s*\\{`,
    "g",
  );
  const bodies = [];
  let match;
  while ((match = re.exec(src)) !== null) {
    let depth = 1;
    let i = match.index + match[0].length;
    for (; i < src.length && depth > 0; i += 1) {
      if (src[i] === "{") depth += 1;
      else if (src[i] === "}") depth -= 1;
    }
    bodies.push(src.slice(match.index, i));
  }
  return bodies;
}

function assertAuthzBeforeMutation(body, mutationPatterns, label) {
  const gateIdx = body.search(
    /requireAdminPermission\s*\(\s*["'][^"']+["']/,
  );
  assert.ok(gateIdx >= 0, `${label}: missing requireAdminPermission`);
  const earlyReturn = body.search(
    /if\s*\(\s*!gate\.ok\s*\)\s*return\s*gate\.response/,
  );
  assert.ok(earlyReturn > gateIdx, `${label}: must return gate.response on deny`);

  for (const pattern of mutationPatterns) {
    const mutIdx = body.search(pattern);
    if (mutIdx < 0) continue;
    assert.ok(
      mutIdx > earlyReturn,
      `${label}: mutation ${pattern} must run after authorization gate`,
    );
  }
}

function loadActorHasPermission() {
  // Real helper from admin-rbac via transpile with mocks for heavy deps.
  const rbacSrc = read("lib/admin-rbac.ts");
  const compiled = ts.transpileModule(rbacSrc, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  });
  const mod = { exports: {} };
  const stubs = {
    "node:crypto": {
      timingSafeEqual(a, b) {
        if (a.length !== b.length) return false;
        let ok = 0;
        for (let i = 0; i < a.length; i += 1) ok |= a[i] ^ b[i];
        return ok === 0;
      },
    },
    "@/lib/admin-auth": {
      getAdminPassword: () => "x",
      getAdminUsername: () => "admin",
    },
    "@/lib/admin-permissions": {
      ADMIN_PERMISSIONS: [
        "winners.manage",
        "members.wallet",
        "members.view",
        "dashboard.view",
      ],
      isAdminPermission: () => true,
    },
    "@/lib/admin-password": {
      hashAdminPassword: async () => "h",
      verifyAdminPassword: async () => false,
    },
    "@/lib/supabase-admin": {
      supabaseAdmin: {
        from() {
          throw new Error("DB must not be touched in A19 unit tests");
        },
      },
    },
  };
  const run = new Function("exports", "module", "require", compiled.outputText);
  run(mod.exports, mod, (id) => {
    if (stubs[id]) return stubs[id];
    throw new Error(`Unexpected require ${id}`);
  });
  return mod.exports;
}

// --- Catalog keys exist; no silent ordinary-role grants in source ---
{
  const perms = read("lib/admin-permissions.ts");
  assert.match(perms, /"winners\.manage"/);
  assert.match(perms, /"members\.wallet"/);
  assert.doesNotMatch(
    perms,
    /winners\.manage["']\s*,\s*["']members\.wallet/,
  );
  // Ordinary seeded role bundles must not auto-add winners.manage via alias.
  assert.doesNotMatch(perms, /lucky_draw\.manage.*=.*winners\.manage/);
  console.log("STATIC permission catalog: OK");
}

// --- requireAdminPermission fail-closed + Super Admin bypass ---
{
  const api = read("lib/admin-api.ts");
  assert.match(api, /export async function requireAdminPermission/);
  assert.match(api, /actorHasPermission\(gate\.actor, permission\)/);
  assert.match(api, /permissionDeniedResponse/);
  assert.match(api, /Forbidden — insufficient permissions\./);
  assert.match(api, /status:\s*403/);
  assert.match(api, /permission_denied/);

  const rbac = read("lib/admin-rbac.ts");
  assert.match(
    rbac,
    /export function actorHasPermission[\s\S]*if \(actor\.isSuperAdmin\) return true/,
  );
  console.log("STATIC requireAdminPermission / Super Admin architecture: OK");
}

// --- UNIT: permission checks (authorized / unauthorized / Super Admin) ---
{
  const { actorHasPermission } = loadActorHasPermission();

  const none = {
    isSuperAdmin: false,
    permissions: new Set(["members.view", "lucky_draw.view"]),
  };
  assert.equal(actorHasPermission(none, "winners.manage"), false);
  assert.equal(actorHasPermission(none, "members.wallet"), false);

  const winnersOnly = {
    isSuperAdmin: false,
    permissions: new Set(["winners.manage"]),
  };
  assert.equal(actorHasPermission(winnersOnly, "winners.manage"), true);
  assert.equal(actorHasPermission(winnersOnly, "members.wallet"), false);

  const walletOnly = {
    isSuperAdmin: false,
    permissions: new Set(["members.wallet"]),
  };
  assert.equal(actorHasPermission(walletOnly, "members.wallet"), true);
  assert.equal(actorHasPermission(walletOnly, "winners.manage"), false);

  const superAdmin = {
    isSuperAdmin: true,
    permissions: new Set(),
  };
  assert.equal(actorHasPermission(superAdmin, "winners.manage"), true);
  assert.equal(actorHasPermission(superAdmin, "members.wallet"), true);

  console.log("UNIT actorHasPermission winners/wallet / Super Admin: OK");
}

// --- A19.1 Winners routes ---
{
  const create = read("app/api/admin/winners/route.ts");
  const item = read("app/api/admin/winners/[id]/route.ts");

  assert.match(
    create,
    /requireAdminPermission\(\s*["']winners\.manage["']/,
  );
  assert.match(
    item,
    /requireAdminPermission\(\s*["']winners\.manage["']/,
  );
  assert.doesNotMatch(create, /requireAdminApi\s*\(/);
  // Item file must not use bare requireAdminApi for mutations.
  assert.doesNotMatch(item, /requireAdminApi\s*\(/);

  const posts = methodBodies(create, "POST");
  assert.equal(posts.length, 1, "winners route must export exactly one POST");
  assertAuthzBeforeMutation(
    posts[0],
    [/\.from\(\s*["']winners["']\s*\)\.insert/, /\.insert\(/],
    "POST /api/admin/winners",
  );

  const puts = methodBodies(item, "PUT");
  const deletes = methodBodies(item, "DELETE");
  assert.equal(puts.length, 1, "winners/[id] must export exactly one PUT");
  assert.equal(deletes.length, 1, "winners/[id] must export exactly one DELETE");

  assertAuthzBeforeMutation(
    puts[0],
    [/\.from\(\s*["']winners["']\s*\)\.update/, /\.update\(/, /\.select\(/],
    "PUT /api/admin/winners/[id]",
  );
  assertAuthzBeforeMutation(
    deletes[0],
    [/\.from\(\s*["']winners["']\s*\)\.delete/, /\.delete\(/, /\.select\(/],
    "DELETE /api/admin/winners/[id]",
  );

  // Only mutation methods exported — no GET bypass on these files.
  assert.doesNotMatch(create, /export\s+async\s+function\s+GET\b/);
  assert.doesNotMatch(item, /export\s+async\s+function\s+GET\b/);
  assert.doesNotMatch(create, /export\s+async\s+function\s+PATCH\b/);
  assert.doesNotMatch(item, /export\s+async\s+function\s+PATCH\b/);

  // Audit success/failure retained
  assert.match(create, /recordSuccess/);
  assert.match(create, /recordFailure/);
  assert.match(create, /winner_created/);
  assert.match(item, /winner_updated/);
  assert.match(item, /winner_deleted/);
  assert.match(item, /recordSuccess/);
  assert.match(item, /recordFailure/);

  // Denied path must not reach insert/update/delete: gate returns before mutations.
  for (const [label, body] of [
    ["create", posts[0]],
    ["update", puts[0]],
    ["delete", deletes[0]],
  ]) {
    const denyReturn = body.indexOf("if (!gate.ok) return gate.response");
    assert.ok(denyReturn >= 0, `${label}: early deny return`);
    const afterDeny = body.slice(denyReturn);
    // First DB mutation after deny check is fine; deny itself returns.
    assert.match(afterDeny, /return gate\.response/);
  }

  // Client-supplied role must not authorize
  assert.equal(/body\.(role|permission|isSuperAdmin)/.test(create + item), false);

  console.log("STATIC winners API RBAC (create/update/delete): OK");
}

// --- A19.2 Wallet route ---
{
  const wallet = read("app/api/admin/users/[id]/wallet/route.ts");

  const posts = methodBodies(wallet, "POST");
  const gets = methodBodies(wallet, "GET");
  assert.equal(posts.length, 1, "wallet route must export exactly one POST");
  assert.equal(gets.length, 1, "wallet route must export exactly one GET");

  assert.match(
    posts[0],
    /requireAdminPermission\(\s*["']members\.wallet["']/,
  );
  assert.match(posts[0], /if\s*\(\s*!gate\.ok\s*\)\s*return\s*gate\.response/);

  assertAuthzBeforeMutation(
    posts[0],
    [
      /\.rpc\(\s*["']admin_post_wallet_transaction["']/,
      /admin_post_wallet_transaction/,
    ],
    "POST /api/admin/users/[id]/wallet",
  );

  // GET: unauthorized without members.wallet; authorized path keeps read contract
  assert.match(
    gets[0],
    /requireAdminPermission\(\s*["']members\.wallet["']/,
  );
  assert.match(gets[0], /if\s*\(\s*!gate\.ok\s*\)\s*return\s*gate\.response/);
  assert.doesNotMatch(gets[0], /requireAdminApi\s*\(/);
  assertAuthzBeforeMutation(
    gets[0],
    [
      /\.from\(\s*["']wallet_accounts["']/,
      /\.from\(\s*["']wallet_transactions["']/,
      /\.from\(\s*["']users["']/,
    ],
    "GET /api/admin/users/[id]/wallet",
  );
  assert.match(gets[0], /wallet:\s*\{/);
  assert.match(gets[0], /transactions:/);
  assert.match(gets[0], /balance:/);
  assert.doesNotMatch(gets[0], /admin_post_wallet_transaction/);

  // Callers: wallet-management tab (members.wallet) + user detail embed AdminWalletPanel
  const tabMap = read("lib/admin-permissions.ts");
  assert.match(
    tabMap,
    /["']wallet-management["']\s*:\s*["']members\.wallet["']/,
  );
  const walletPanel = read("app/dashboard/components/admin-wallet-panel.tsx");
  assert.match(
    walletPanel,
    /\/api\/admin\/users\/\$\{encodeURIComponent\(userId\)\}\/wallet/,
  );
  assert.match(
    read("app/dashboard/components/wallet-management-panel.tsx"),
    /AdminWalletPanel/,
  );
  assert.match(
    read("app/dashboard/users/[id]/page.tsx"),
    /AdminWalletPanel/,
  );
  assert.match(
    read("app/dashboard/dashboard-tabs.tsx"),
    /WalletManagementPanel/,
  );

  // Idempotency preserved
  assert.match(wallet, /idempotency_key/);
  assert.match(wallet, /p_idempotency_key:\s*idempotencyKey/);
  assert.match(wallet, /A valid idempotency key is required/);

  // Audit preserved
  assert.match(wallet, /wallet_transaction_posted/);
  assert.match(wallet, /wallet_transaction_failed/);
  assert.match(wallet, /recordSuccess/);
  assert.match(wallet, /recordFailure/);

  // Ledger RPC and validation preserved
  assert.match(wallet, /admin_post_wallet_transaction/);
  assert.match(wallet, /transaction_type/);
  assert.match(wallet, /credit/);
  assert.match(wallet, /debit/);
  assert.match(wallet, /normalizeAmount/);

  // No PATCH/PUT alternate mutation path on this route
  assert.doesNotMatch(wallet, /export\s+async\s+function\s+PUT\b/);
  assert.doesNotMatch(wallet, /export\s+async\s+function\s+PATCH\b/);
  assert.doesNotMatch(wallet, /export\s+async\s+function\s+DELETE\b/);

  // File must not fall back to session-only requireAdminApi for wallet data
  assert.doesNotMatch(wallet, /requireAdminApi\s*\(/);

  assert.equal(/body\.(role|permission|isSuperAdmin)/.test(wallet), false);

  console.log("STATIC wallet API RBAC (GET read + POST credit/debit): OK");
}

// --- No alternate winners/wallet mutation APIs without the same gates ---
{
  const winnersFiles = [
    "app/api/admin/winners/route.ts",
    "app/api/admin/winners/[id]/route.ts",
  ];
  for (const rel of winnersFiles) {
    assert.ok(fs.existsSync(path.join(root, rel)), rel);
  }
  // Only these two winners API files under admin.
  const winnersDir = path.join(root, "app/api/admin/winners");
  const walk = (dir) => {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walk(p));
      else if (entry.name === "route.ts") out.push(p);
    }
    return out;
  };
  const found = walk(winnersDir).map((p) => path.relative(root, p));
  assert.deepEqual(found.sort(), winnersFiles.sort());

  const walletRel = "app/api/admin/users/[id]/wallet/route.ts";
  assert.ok(fs.existsSync(path.join(root, walletRel)));

  console.log("STATIC no alternate winners/wallet route bypass: OK");
}

// --- A18 hotfix still present ---
{
  const display = read("lib/dashboard-listing-fare-display.ts");
  assert.equal([...display.matchAll(/^\s*import\s+/gm)].length, 0);
  const tabs = read("app/dashboard/dashboard-tabs.tsx");
  assert.match(tabs, /from\s+["']@\/lib\/dashboard-listing-fare-display["']/);
  assert.doesNotMatch(tabs, /from\s+["']@\/lib\/dashboard-listing-fare["']/);
  console.log("STATIC A18 fare display hotfix intact: OK");
}

console.log("verify-admin-lucky-draw-rbac-a19: OK");
console.log(
  "NOTE: Live HTTP 401/403/authorized matrix and DB mutation proofs were NOT executed.",
);
