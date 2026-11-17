/**
 * A19-B-FIX-02 — Admin Lucky Draw prize-lot wallet integration.
 * Run: npm run test:admin-lucky-draw-prize-lots-a19
 *
 * STATIC + UNIT only. Does not connect to a database or live HTTP.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

function loadPrizeLotHelpers() {
  const src = read("lib/lucky-draw-prize-lot.ts");
  const compiled = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  });
  const mod = { exports: {} };
  const run = new Function("exports", "module", "require", compiled.outputText);
  run(mod.exports, mod, () => {
    throw new Error("prize-lot helpers must not require modules");
  });
  return mod.exports;
}

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

const helpers = loadPrizeLotHelpers();
const {
  planLuckyDrawPrizeLot,
  validateWinnerRecipientLink,
  buildLuckyDrawLotIdempotencyKey,
  kolkataDateKey,
  parseCivilDate,
  isUuid,
  HELD_PRIZE_MESSAGE,
} = helpers;

const WINNER_A = "11111111-1111-4111-8111-111111111111";
const WINNER_B = "22222222-2222-4222-8222-222222222222";
const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

// --- UNIT: dated prize plans held lot; undated plans post ---
{
  const today = kolkataDateKey();
  const dated = planLuckyDrawPrizeLot({
    transactionType: "credit",
    source: "lucky_draw_prize",
    expiresOnRaw: today,
    todayKey: today,
  });
  assert.equal(dated.kind, "dated_hold");
  assert.equal(dated.expiresOn, today);

  const undated = planLuckyDrawPrizeLot({
    transactionType: "credit",
    source: "lucky_draw_prize",
    expiresOnRaw: "",
    todayKey: today,
  });
  assert.equal(undated.kind, "undated_post");
  assert.equal(undated.expiresOn, null);

  const past = planLuckyDrawPrizeLot({
    transactionType: "credit",
    source: "lucky_draw_prize",
    expiresOnRaw: "2000-01-01",
    todayKey: today,
  });
  assert.equal(past.kind, "reject");
  assert.equal(past.status, 400);

  const bad = planLuckyDrawPrizeLot({
    transactionType: "credit",
    source: "lucky_draw_prize",
    expiresOnRaw: "02-11-2026",
    todayKey: today,
  });
  assert.equal(bad.kind, "reject");

  const nonPrizeExpiry = planLuckyDrawPrizeLot({
    transactionType: "credit",
    source: "admin_credit",
    expiresOnRaw: today,
    todayKey: today,
  });
  assert.equal(nonPrizeExpiry.kind, "reject");

  console.log("UNIT planLuckyDrawPrizeLot dated/undated/reject: OK");
}

// --- UNIT: winner / recipient linkage ---
{
  const missing = validateWinnerRecipientLink({
    winnerIdRaw: "",
    routeUserId: USER_A,
    winnerRow: null,
  });
  assert.equal(missing.ok, false);
  assert.match(missing.error, /Winner ID is required/i);

  const invalid = validateWinnerRecipientLink({
    winnerIdRaw: "not-a-uuid",
    routeUserId: USER_A,
    winnerRow: null,
  });
  assert.equal(invalid.ok, false);
  assert.match(invalid.error, /valid UUID/i);

  const notFound = validateWinnerRecipientLink({
    winnerIdRaw: WINNER_A,
    routeUserId: USER_A,
    winnerRow: null,
  });
  assert.equal(notFound.ok, false);
  assert.match(notFound.error, /Winner not found/i);

  const mismatch = validateWinnerRecipientLink({
    winnerIdRaw: WINNER_A,
    routeUserId: USER_A,
    winnerRow: { id: WINNER_A, user_id: USER_B },
  });
  assert.equal(mismatch.ok, false);
  assert.match(mismatch.error, /different member/i);

  const linkedOk = validateWinnerRecipientLink({
    winnerIdRaw: WINNER_A,
    routeUserId: USER_A,
    winnerRow: { id: WINNER_A, user_id: USER_A },
  });
  assert.equal(linkedOk.ok, true);
  assert.equal(linkedOk.recipientUserId, USER_A);

  const textOnlyOk = validateWinnerRecipientLink({
    winnerIdRaw: WINNER_B,
    routeUserId: USER_A,
    winnerRow: { id: WINNER_B, user_id: null },
  });
  assert.equal(textOnlyOk.ok, true);
  assert.equal(textOnlyOk.recipientUserId, USER_A);

  console.log("UNIT validateWinnerRecipientLink: OK");
}

// --- UNIT: idempotency key stability ---
{
  const key1 = buildLuckyDrawLotIdempotencyKey({
    userId: USER_A,
    winnerId: WINNER_A,
    amount: 100,
    expiresOn: "2026-12-01",
    clientKey: "retry-1",
  });
  const key2 = buildLuckyDrawLotIdempotencyKey({
    userId: USER_A,
    winnerId: WINNER_A,
    amount: 100,
    expiresOn: "2026-12-01",
    clientKey: "retry-1",
  });
  assert.equal(key1, key2);
  assert.ok(key1.length <= 200);
  assert.match(key1, /^ld-lot:/);

  const differentWinner = buildLuckyDrawLotIdempotencyKey({
    userId: USER_A,
    winnerId: WINNER_B,
    amount: 100,
    expiresOn: "2026-12-01",
    clientKey: "retry-1",
  });
  assert.notEqual(key1, differentWinner);

  console.log("UNIT buildLuckyDrawLotIdempotencyKey: OK");
}

// --- STATIC: wallet route prize-lot integration ---
{
  const wallet = read("app/api/admin/users/[id]/wallet/route.ts");
  const posts = methodBodies(wallet, "POST");
  assert.equal(posts.length, 1);
  const post = posts[0];

  assert.match(post, /requireAdminPermission\(\s*["']members\.wallet["']/);
  assert.match(post, /if\s*\(\s*!gate\.ok\s*\)\s*return\s*gate\.response/);

  // Prize path uses held-lot RPCs — never bare lucky_draw_prize credit.
  assert.match(post, /admin_create_held_lucky_draw_prize_lot/);
  assert.match(post, /admin_post_held_lucky_draw_prize_lot/);
  assert.match(post, /planLuckyDrawPrizeLot/);
  assert.match(post, /validateWinnerRecipientLink/);
  assert.match(post, /buildLuckyDrawLotIdempotencyKey/);
  assert.match(post, /held:\s*true/);
  assert.match(post, /status:\s*409/);
  assert.match(post, /spendable:\s*false/);
  assert.match(post, /HELD_PRIZE_MESSAGE/);

  // Dated hold must not call post RPC before returning 409.
  const datedHoldIdx = post.search(/plan\.kind\s*===\s*["']dated_hold["']/);
  assert.ok(datedHoldIdx >= 0, "dated_hold branch required");
  const afterDated = post.slice(datedHoldIdx);
  const datedReturn409 = afterDated.search(/status:\s*409/);
  const postRpcInDatedBranch = afterDated
    .slice(0, datedReturn409 + 40)
    .includes("admin_post_held_lucky_draw_prize_lot");
  assert.equal(
    postRpcInDatedBranch,
    false,
    "dated_hold must not call admin_post_held before 409",
  );

  // Bare prize credit via admin_post_wallet_transaction must not occur on prize path.
  // Non-prize path retains the legacy RPC.
  assert.match(post, /admin_post_wallet_transaction/);
  assert.match(post, /p_idempotency_key:\s*idempotencyKey/);

  // Prize branch must gate before create RPC.
  const gateReturn = post.search(/if\s*\(\s*!gate\.ok\s*\)\s*return\s*gate\.response/);
  const createRpc = post.search(/admin_create_held_lucky_draw_prize_lot/);
  assert.ok(createRpc > gateReturn, "create lot RPC after authz gate");

  // Audit retained for prize + ordinary paths.
  assert.match(wallet, /wallet_transaction_posted/);
  assert.match(wallet, /wallet_transaction_failed/);
  assert.match(wallet, /lucky_draw_prize_lot_held/);
  assert.match(wallet, /recordSuccess/);
  assert.match(wallet, /recordFailure/);

  // No inventing winner ids.
  assert.doesNotMatch(post, /crypto\.randomUUID\(\)/);
  assert.doesNotMatch(post, /\.limit\(\s*1\s*\).*winners/s);

  console.log("STATIC wallet prize-lot route: OK");
}

// --- STATIC: UI held vs spendable distinction ---
{
  const panel = read("app/dashboard/components/admin-wallet-panel.tsx");
  assert.match(panel, /winnerId|winner_id/);
  assert.match(panel, /expiresOn|expires_on/);
  assert.match(panel, /heldNotice|data\.held/);
  assert.match(panel, /Held prize/);
  assert.match(panel, /not spendable/i);
  assert.match(panel, /Create Held Prize Lot|Post Prize Lot Credit/);
  // Held 409 path sets heldNotice and returns — not emerald success.
  assert.match(panel, /response\.status\s*===\s*409\s*&&\s*data\.held/);
  assert.match(panel, /setHeldNotice\(/);
  const heldBlockMatch = panel.match(
    /if\s*\(\s*response\.status\s*===\s*409\s*&&\s*data\.held\s*\)\s*\{[\s\S]*?\n\s*\}/,
  );
  assert.ok(heldBlockMatch, "held 409 branch block required");
  assert.doesNotMatch(heldBlockMatch[0], /setSuccess\(/);
  assert.match(heldBlockMatch[0], /setHeldNotice\(/);
  assert.match(heldBlockMatch[0], /return;/);

  console.log("STATIC admin wallet UI held messaging: OK");
}

// --- STATIC: winners.manage untouched; A19 RBAC file still present ---
{
  assert.match(
    read("app/api/admin/winners/route.ts"),
    /requireAdminPermission\(\s*["']winners\.manage["']/,
  );
  assert.match(
    read("app/api/admin/winners/[id]/route.ts"),
    /requireAdminPermission\(\s*["']winners\.manage["']/,
  );
  assert.ok(fs.existsSync(path.join(root, "scripts/verify-admin-lucky-draw-rbac-a19.mjs")));
  console.log("STATIC winners.manage + A19 RBAC script intact: OK");
}

// --- Sanity: civil date / IST helpers ---
{
  assert.equal(parseCivilDate("2026-11-02"), "2026-11-02");
  assert.equal(parseCivilDate("2026-13-01"), null);
  assert.match(kolkataDateKey(), /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(typeof HELD_PRIZE_MESSAGE === "string" && HELD_PRIZE_MESSAGE.length > 20);
  console.log("UNIT date helpers: OK");
}

// --- A19-B-FINAL-02: text-only winner product + optional explicit link ---
{
  const linkSrc = read("lib/admin-winner-user-link.ts");
  const compiled = ts.transpileModule(linkSrc, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  });
  const mod = { exports: {} };
  const stubs = {
    "@/lib/lucky-draw-prize-lot": { isUuid },
  };
  const run = new Function("exports", "module", "require", compiled.outputText);
  run(mod.exports, mod, (id) => {
    if (stubs[id]) return stubs[id];
    throw new Error(`Unexpected require ${id}`);
  });
  const { resolveOptionalWinnerUserId } = mod.exports;

  const absent = resolveOptionalWinnerUserId({ date: "2026-11-02" });
  assert.equal(absent.ok, true);
  assert.equal(absent.provided, false);
  assert.equal(absent.userId, null);

  const explicitNull = resolveOptionalWinnerUserId({ user_id: null });
  assert.equal(explicitNull.ok, true);
  assert.equal(explicitNull.provided, true);
  assert.equal(explicitNull.userId, null);

  const explicitMember = resolveOptionalWinnerUserId({ user_id: USER_A });
  assert.equal(explicitMember.ok, true);
  assert.equal(explicitMember.provided, true);
  assert.equal(explicitMember.userId, USER_A);

  const bad = resolveOptionalWinnerUserId({ user_id: "not-uuid" });
  assert.equal(bad.ok, false);

  const create = read("app/api/admin/winners/route.ts");
  const item = read("app/api/admin/winners/[id]/route.ts");
  const tabs = read("app/dashboard/dashboard-tabs.tsx");

  // Create defaults to text-only; never invents a member.
  assert.match(create, /resolveOptionalWinnerUserId/);
  assert.match(create, /Linked member not found/);
  assert.match(create, /\.select\(\s*["']id, date, user_id, winner_text["']/);
  assert.doesNotMatch(create, /user_id:\s*winnerUsers/);
  assert.doesNotMatch(create, /Math\.random/);

  // Update preserves existing user_id unless explicitly provided.
  assert.match(item, /resolveOptionalWinnerUserId/);
  assert.match(item, /link\.provided/);
  assert.doesNotMatch(
    item,
    /const payload = \{[\s\S]*user_id:\s*null/,
  );

  // UI is intentionally text-only (date + winner_text); no member picker in modal.
  const createWinnerFn = tabs.match(
    /const createWinner = async \(\) => \{[\s\S]*?\n  \};/,
  );
  assert.ok(createWinnerFn, "createWinner handler required");
  assert.match(createWinnerFn[0], /winner_text:\s*winnerText/);
  assert.doesNotMatch(createWinnerFn[0], /user_id\s*:/);
  assert.match(tabs, /Text-only winner \(no member picker\)/);
  assert.match(tabs, /Winner ID/);
  assert.match(tabs, /Multiple winners may[\s\S]*same draw date/);
  // Modal fields: date + winner text only (no member <select> in winner modal).
  const winnerModal = tabs.match(
    /\{showWinnerModal \? \([\s\S]*?\) : null\}/,
  );
  assert.ok(winnerModal, "winner modal required");
  assert.doesNotMatch(winnerModal[0], /<select[\s\S]*selectedUserId/);
  assert.doesNotMatch(winnerModal[0], /option value="">.*[Mm]ember/);

  // Multiple winners per date: no unique-date guard on create.
  assert.doesNotMatch(create, /unique.*date|already exists for this date/i);

  console.log("UNIT/STATIC winner linkage product decision: OK");
}

console.log("verify-admin-lucky-draw-prize-lots-a19: OK");
console.log(
  "NOTE: Live HTTP/DB mutation proofs and Mobile migration apply were NOT executed.",
);
