import { NextResponse } from "next/server";

import { requireAdminPermission, safeErrorMessage } from "@/lib/admin-api";
import { clientMetaFromRequest, recordFailure, recordSuccess } from "@/lib/admin-audit";
import {
  buildLuckyDrawLotIdempotencyKey,
  HELD_PRIZE_MESSAGE,
  kolkataDateKey,
  planLuckyDrawPrizeLot,
  validateWinnerRecipientLink,
} from "@/lib/lucky-draw-prize-lot";

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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireAdminPermission("members.wallet", {
    request,
    auditModule: "wallet",
  });
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
  const gate = await requireAdminPermission("members.wallet", {
    request,
    auditModule: "wallet",
  });
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

  const isLuckyDrawPrizeCredit =
    transactionType === "credit" && source === "lucky_draw_prize";

  // --- A19 prize-lot path: never bare admin_post_wallet_transaction for prizes ---
  if (isLuckyDrawPrizeCredit) {
    const plan = planLuckyDrawPrizeLot({
      transactionType,
      source,
      expiresOnRaw: body.expires_on,
      todayKey: kolkataDateKey(),
    });
    if (plan.kind === "reject") {
      return NextResponse.json({ ok: false, error: plan.error }, { status: plan.status });
    }

    const winnerIdRaw = body.winner_id ?? body.reference_id;
    const { data: winnerRow, error: winnerLookupError } = await gate.supabase
      .from("winners")
      .select("id, user_id")
      .eq("id", String(winnerIdRaw ?? "").trim())
      .maybeSingle();

    if (winnerLookupError) {
      const message = safeErrorMessage(winnerLookupError, "Unable to verify winner.");
      await recordFailure({
        actor: gate.actor,
        action: "wallet_transaction_failed",
        module: "wallet",
        description: `Lucky Draw prize lot failed for member ${id}`,
        resourceType: "lucky_draw_prize_lot",
        resourceId: id,
        relatedUserId: id,
        reason: message,
        metadata: { amount, source, winner_id: winnerIdRaw ?? null },
        ...clientMetaFromRequest(request),
      });
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }

    const link = validateWinnerRecipientLink({
      winnerIdRaw,
      routeUserId: id,
      winnerRow: winnerRow
        ? { id: String(winnerRow.id), user_id: (winnerRow.user_id as string | null) ?? null }
        : null,
    });
    if (!link.ok) {
      await recordFailure({
        actor: gate.actor,
        action: "wallet_transaction_failed",
        module: "wallet",
        description: `Lucky Draw prize lot rejected for member ${id}`,
        resourceType: "lucky_draw_prize_lot",
        resourceId: id,
        relatedUserId: id,
        reason: link.error,
        metadata: {
          amount,
          source,
          winner_id: String(winnerIdRaw ?? "").trim() || null,
          expires_on: plan.expiresOn,
        },
        ...clientMetaFromRequest(request),
      });
      return NextResponse.json({ ok: false, error: link.error }, { status: link.status });
    }

    const lotIdempotencyKey = buildLuckyDrawLotIdempotencyKey({
      userId: link.recipientUserId,
      winnerId: link.winnerId,
      amount,
      expiresOn: plan.expiresOn,
      clientKey: idempotencyKey,
    });

    const lotMeta = {
      transaction_type: transactionType,
      amount,
      source,
      winner_id: link.winnerId,
      recipient_user_id: link.recipientUserId,
      expires_on: plan.expiresOn,
      remarks,
      idempotency_key: lotIdempotencyKey,
      plan: plan.kind,
    };

    const { data: createData, error: createError } = await gate.supabase.rpc(
      "admin_create_held_lucky_draw_prize_lot",
      {
        p_winner_id: link.winnerId,
        p_recipient_user_id: link.recipientUserId,
        p_amount: amount,
        p_expires_on: plan.expiresOn,
        p_idempotency_key: lotIdempotencyKey,
        p_remarks: remarks,
        p_created_by: "admin_panel",
      },
    );

    if (createError) {
      const message = safeErrorMessage(createError, "Unable to create Lucky Draw prize lot.");
      await recordFailure({
        actor: gate.actor,
        action: "wallet_transaction_failed",
        module: "wallet",
        description: `Lucky Draw prize lot create failed for member ${id}`,
        resourceType: "lucky_draw_prize_lot",
        resourceId: id,
        relatedUserId: id,
        reason: message,
        metadata: lotMeta,
        ...clientMetaFromRequest(request),
      });
      return NextResponse.json({ ok: false, error: message }, { status: 400 });
    }

    const createRecord = asRecord(createData);
    const lotId =
      createRecord && createRecord.lot_id != null ? String(createRecord.lot_id) : null;
    const lotStatus =
      createRecord && createRecord.status != null ? String(createRecord.status) : null;
    const duplicate = Boolean(createRecord?.duplicate);

    if (!lotId) {
      const message = "Prize lot create returned no lot id.";
      await recordFailure({
        actor: gate.actor,
        action: "wallet_transaction_failed",
        module: "wallet",
        description: `Lucky Draw prize lot create incomplete for member ${id}`,
        resourceType: "lucky_draw_prize_lot",
        resourceId: id,
        relatedUserId: id,
        reason: message,
        metadata: { ...lotMeta, create: createRecord },
        ...clientMetaFromRequest(request),
      });
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }

    // Dated prizes stay held — never call admin_post_held_* / bare wallet credit.
    if (plan.kind === "dated_hold") {
      await recordSuccess({
        actor: gate.actor,
        action: "lucky_draw_prize_lot_held",
        module: "wallet",
        description: `Lucky Draw prize lot ${lotId} held for member ${id} (expires ${plan.expiresOn})`,
        resourceType: "lucky_draw_prize_lot",
        resourceId: lotId,
        relatedUserId: id,
        afterData: createRecord,
        metadata: lotMeta,
        ...clientMetaFromRequest(request),
      });

      return NextResponse.json(
        {
          ok: false,
          held: true,
          error: HELD_PRIZE_MESSAGE,
          lot: {
            lot_id: lotId,
            status: lotStatus ?? "held",
            expires_on: plan.expiresOn,
            winner_id: link.winnerId,
            recipient_user_id: link.recipientUserId,
            amount,
            duplicate,
            spendable: false,
          },
        },
        { status: 409 },
      );
    }

    // Undated: if already posted (idempotent retry), return success without re-posting.
    if (lotStatus && lotStatus !== "held") {
      await recordSuccess({
        actor: gate.actor,
        action: "wallet_transaction_posted",
        module: "wallet",
        description: `Lucky Draw prize lot ${lotId} already posted for member ${id}`,
        resourceType: "lucky_draw_prize_lot",
        resourceId: lotId,
        relatedUserId: id,
        afterData: createRecord,
        metadata: { ...lotMeta, duplicate: true },
        ...clientMetaFromRequest(request),
      });
      return NextResponse.json({
        ok: true,
        result: createRecord,
        lot: {
          lot_id: lotId,
          status: lotStatus,
          expires_on: null,
          winner_id: link.winnerId,
          recipient_user_id: link.recipientUserId,
          amount,
          duplicate: true,
          spendable: true,
        },
      });
    }

    const { data: postData, error: postError } = await gate.supabase.rpc(
      "admin_post_held_lucky_draw_prize_lot",
      {
        p_lot_id: lotId,
        p_created_by: "admin_panel",
      },
    );

    if (postError) {
      const message = safeErrorMessage(postError, "Unable to post Lucky Draw prize lot.");
      await recordFailure({
        actor: gate.actor,
        action: "wallet_transaction_failed",
        module: "wallet",
        description: `Lucky Draw prize lot post failed for member ${id}`,
        resourceType: "lucky_draw_prize_lot",
        resourceId: lotId,
        relatedUserId: id,
        reason: message,
        metadata: { ...lotMeta, lot_id: lotId },
        ...clientMetaFromRequest(request),
      });
      return NextResponse.json({ ok: false, error: message }, { status: 400 });
    }

    const postRecord = asRecord(postData);
    const transactionId =
      postRecord && postRecord.transaction_id != null
        ? String(postRecord.transaction_id)
        : lotId;

    await recordSuccess({
      actor: gate.actor,
      action: "wallet_transaction_posted",
      module: "wallet",
      description: `Lucky Draw prize lot ${lotId} posted for member ${id}`,
      resourceType: "wallet_transaction",
      resourceId: transactionId,
      relatedUserId: id,
      afterData: postRecord,
      metadata: lotMeta,
      ...clientMetaFromRequest(request),
    });

    return NextResponse.json({
      ok: true,
      result: postRecord,
      lot: {
        lot_id: lotId,
        status: postRecord?.status ?? "active",
        expires_on: null,
        winner_id: link.winnerId,
        recipient_user_id: link.recipientUserId,
        amount,
        duplicate: Boolean(postRecord?.duplicate) || duplicate,
        spendable: true,
      },
    });
  }

  // Reject stray expiry on non-prize transactions.
  const strayExpiry = planLuckyDrawPrizeLot({
    transactionType,
    source,
    expiresOnRaw: body.expires_on,
    todayKey: kolkataDateKey(),
  });
  if (strayExpiry.kind === "reject") {
    return NextResponse.json(
      { ok: false, error: strayExpiry.error },
      { status: strayExpiry.status },
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

  const resultRecord = asRecord(data);
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
