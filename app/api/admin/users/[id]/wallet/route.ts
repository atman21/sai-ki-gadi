import { NextResponse } from "next/server";

import { requireAdminApi, safeErrorMessage } from "@/lib/admin-api";
import { clientMetaFromRequest, recordFailure, recordSuccess } from "@/lib/admin-audit";
import {
  evaluateLuckyDrawExpiry,
  kolkataDateKey,
} from "@/lib/lucky-draw-prize-expiry";

type WalletTransactionType = "credit" | "debit";

const ALLOWED_SOURCES = new Set([
  "lucky_draw_prize",
  "admin_credit",
  "refund",
  "wallet_usage",
  "admin_debit",
  "admin_adjustment",
]);

function normalizeAmount(value: unknown): number | null {
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (Math.abs(amount - Number(amount.toFixed(2))) > 1e-9) return null;
  return amount;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const { id } = await params;

  const [userResult, accountResult, transactionsResult] = await Promise.all([
    gate.supabase.from("users").select("id").eq("id", id).maybeSingle(),
    gate.supabase
      .from("wallet_accounts")
      .select("balance, updated_at")
      .eq("user_id", id)
      .maybeSingle(),
    gate.supabase
      .from("wallet_transactions")
      .select(
        "id, transaction_type, amount, balance_before, balance_after, source, remarks, reference_type, reference_id, created_by, created_at",
      )
      .eq("user_id", id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(100),
  ]);

  if (userResult.error) {
    return NextResponse.json(
      { ok: false, error: safeErrorMessage(userResult.error, "Unable to load user.") },
      { status: 500 },
    );
  }
  if (!userResult.data) {
    return NextResponse.json({ ok: false, error: "User not found." }, { status: 404 });
  }

  if (accountResult.error) {
    return NextResponse.json(
      { ok: false, error: safeErrorMessage(accountResult.error, "Unable to load wallet balance.") },
      { status: 500 },
    );
  }
  if (transactionsResult.error) {
    return NextResponse.json(
      { ok: false, error: safeErrorMessage(transactionsResult.error, "Unable to load wallet transactions.") },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    wallet: {
      balance: Number(accountResult.data?.balance ?? 0),
      updated_at: accountResult.data?.updated_at ?? null,
      transactions: (transactionsResult.data ?? []).map((row) => ({
        ...row,
        amount: Number(row.amount),
        balance_before: Number(row.balance_before),
        balance_after: Number(row.balance_after),
      })),
    },
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const transactionType = String(body.transaction_type ?? "").trim() as WalletTransactionType;
  if (transactionType !== "credit" && transactionType !== "debit") {
    return NextResponse.json({ ok: false, error: "Select Credit or Debit." }, { status: 400 });
  }

  const amount = normalizeAmount(body.amount);
  if (amount == null) {
    return NextResponse.json(
      { ok: false, error: "Enter a valid amount with maximum 2 decimal places." },
      { status: 400 },
    );
  }

  const remarks = String(body.remarks ?? "").trim();
  if (!remarks) {
    return NextResponse.json({ ok: false, error: "Remarks are required." }, { status: 400 });
  }
  if (remarks.length > 500) {
    return NextResponse.json({ ok: false, error: "Remarks are too long." }, { status: 400 });
  }

  const sourceRaw = String(body.source ?? "").trim();
  const source = ALLOWED_SOURCES.has(sourceRaw) ? sourceRaw : "admin_adjustment";

  const referenceType = String(body.reference_type ?? "").trim() || null;
  const referenceId = String(body.reference_id ?? "").trim() || null;
  const idempotencyKey = String(body.idempotency_key ?? "").trim();
  if (!idempotencyKey || idempotencyKey.length > 200) {
    return NextResponse.json(
      { ok: false, error: "A valid idempotency key is required." },
      { status: 400 },
    );
  }

  const expiry = evaluateLuckyDrawExpiry({
    transactionType,
    source,
    expiresOnRaw: body.expires_on,
    todayKey: kolkataDateKey(),
  });
  if (expiry.action !== "post") {
    return NextResponse.json(
      { ok: false, error: expiry.error },
      { status: expiry.status },
    );
  }

  const { data, error } = await gate.supabase.rpc("admin_post_wallet_transaction", {
    p_user_id: id,
    p_transaction_type: transactionType,
    p_amount: amount,
    p_remarks: remarks,
    p_source: source,
    p_reference_type: referenceType,
    p_reference_id: referenceId,
    p_idempotency_key: idempotencyKey,
    p_created_by: "admin_panel",
  });

  const walletMeta = {
    transaction_type: transactionType,
    amount,
    source,
    reference_type: referenceType,
    reference_id: referenceId,
    remarks,
  };

  if (error) {
    const message = safeErrorMessage(error, "Unable to post wallet transaction.");
    const status = /insufficient wallet balance/i.test(error.message ?? "") ? 409 : 400;
    await recordFailure({
      actor: gate.actor,
      action: "wallet_transaction_failed",
      module: "wallet",
      description: `Wallet ${transactionType} of ${amount} failed for member ${id}`,
      resourceType: "wallet_transaction",
      resourceId: id,
      relatedUserId: id,
      reason: message,
      metadata: walletMeta,
      ...clientMetaFromRequest(request),
    });
    return NextResponse.json({ ok: false, error: message }, { status });
  }

  const resultRecord =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : null;
  const transactionId =
    resultRecord && resultRecord.id != null
      ? String(resultRecord.id)
      : resultRecord && resultRecord.transaction_id != null
        ? String(resultRecord.transaction_id)
        : id;

  await recordSuccess({
    actor: gate.actor,
    action: "wallet_transaction_posted",
    module: "wallet",
    description: `Wallet ${transactionType} of ${amount} posted for member ${id}`,
    resourceType: "wallet_transaction",
    resourceId: transactionId,
    relatedUserId: id,
    afterData: resultRecord,
    metadata: walletMeta,
    ...clientMetaFromRequest(request),
  });

  return NextResponse.json({ ok: true, result: data });
}
