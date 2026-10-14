import { NextResponse } from "next/server";

import { requireAdminApi, safeErrorMessage } from "@/lib/admin-api";
import { normalizeWalletAmount } from "@/lib/admin-wallet-amount";
import { scopeWalletIdempotencyKey } from "@/lib/admin-wallet-idempotency";

type WalletTransactionType = "credit" | "debit";

const ALLOWED_SOURCES = new Set([
  "lucky_draw_prize",
  "admin_credit",
  "refund",
  "wallet_usage",
  "admin_debit",
  "admin_adjustment",
]);

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

function parsePage(value: string | null): number {
  const n = Number(value ?? "1");
  if (!Number.isInteger(n) || n < 1) return 1;
  return n;
}

function parsePageSize(value: string | null): number {
  const n = Number(value ?? String(DEFAULT_PAGE_SIZE));
  if (!Number.isInteger(n) || n < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(n, MAX_PAGE_SIZE);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const page = parsePage(searchParams.get("page"));
  const pageSize = parsePageSize(searchParams.get("pageSize"));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

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
        { count: "exact" },
      )
      .eq("user_id", id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to),
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
      {
        ok: false,
        error: safeErrorMessage(accountResult.error, "Unable to load wallet balance."),
      },
      { status: 500 },
    );
  }
  if (transactionsResult.error) {
    return NextResponse.json(
      {
        ok: false,
        error: safeErrorMessage(
          transactionsResult.error,
          "Unable to load wallet transactions.",
        ),
      },
      { status: 500 },
    );
  }

  const total = transactionsResult.count ?? 0;
  const transactions = (transactionsResult.data ?? []).map((row) => ({
    ...row,
    amount: Number(row.amount),
    balance_before: Number(row.balance_before),
    balance_after: Number(row.balance_after),
  }));

  return NextResponse.json({
    ok: true,
    wallet: {
      balance: Number(accountResult.data?.balance ?? 0),
      updated_at: accountResult.data?.updated_at ?? null,
      transactions,
      page,
      pageSize,
      total,
      hasMore: from + transactions.length < total,
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

  const amount = normalizeWalletAmount(body.amount);
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

  // Always rebind the key to this path's user id so a copied key from another
  // user/session cannot collide with a different ledger stream.
  const scopedKey = scopeWalletIdempotencyKey(
    id,
    String(body.idempotency_key ?? ""),
  );
  if (!scopedKey) {
    return NextResponse.json(
      { ok: false, error: "A valid idempotency key is required." },
      { status: 400 },
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
    p_idempotency_key: scopedKey,
    p_created_by: "admin_panel",
  });

  if (error) {
    const message = safeErrorMessage(error, "Unable to post wallet transaction.");
    const status = /insufficient wallet balance/i.test(error.message ?? "") ? 409 : 400;
    return NextResponse.json({ ok: false, error: message }, { status });
  }

  return NextResponse.json({
    ok: true,
    result: data,
    idempotency_key: scopedKey,
  });
}
