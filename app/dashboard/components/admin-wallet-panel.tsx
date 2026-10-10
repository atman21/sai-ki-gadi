"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type WalletTransaction = {
  id: string;
  transaction_type: "credit" | "debit";
  amount: number;
  balance_before: number;
  balance_after: number;
  source: string;
  remarks: string;
  reference_type: string | null;
  reference_id: string | null;
  created_by: string | null;
  created_at: string;
};

type WalletResponse = {
  ok: boolean;
  error?: string;
  wallet?: {
    balance: number;
    updated_at: string | null;
    transactions: WalletTransaction[];
  };
};

const SOURCE_OPTIONS = {
  credit: [
    ["lucky_draw_prize", "Lucky Draw Prize"],
    ["admin_credit", "Admin Credit"],
    ["refund", "Refund"],
    ["admin_adjustment", "Admin Adjustment"],
  ],
  debit: [
    ["wallet_usage", "Wallet Usage"],
    ["admin_debit", "Admin Debit"],
    ["admin_adjustment", "Admin Adjustment"],
  ],
} as const;

const SOURCE_LABELS: Record<string, string> = {
  lucky_draw_prize: "Lucky Draw Prize",
  admin_credit: "Admin Credit",
  refund: "Refund",
  wallet_usage: "Wallet Usage",
  admin_debit: "Admin Debit",
  admin_adjustment: "Admin Adjustment",
};

function money(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
  }).format(value);
}

function dateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function newIdempotencyKey() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `admin-wallet-${crypto.randomUUID()}`;
  }
  return `admin-wallet-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function AdminWalletPanel({ userId }: { userId: string }) {
  const [balance, setBalance] = useState<number | null>(null);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [transactionType, setTransactionType] = useState<"credit" | "debit">("credit");
  const [amount, setAmount] = useState("");
  const [source, setSource] = useState("lucky_draw_prize");
  const [remarks, setRemarks] = useState("");
  const [referenceId, setReferenceId] = useState("");
  const pendingSubmission = useRef<{ fingerprint: string; key: string } | null>(null);

  const loadWallet = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/wallet`, {
        cache: "no-store",
      });
      const data = (await response.json()) as WalletResponse;
      if (!response.ok || !data.ok || !data.wallet) {
        throw new Error(data.error || "Unable to load wallet.");
      }
      setBalance(Number(data.wallet.balance));
      setTransactions(data.wallet.transactions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load wallet.");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void loadWallet();
  }, [loadWallet]);

  useEffect(() => {
    setSource(transactionType === "credit" ? "lucky_draw_prize" : "wallet_usage");
  }, [transactionType]);

  const parsedAmount = Number(amount);
  const balanceAfter = useMemo(() => {
    if (balance == null || !Number.isFinite(parsedAmount) || parsedAmount <= 0) return null;
    return transactionType === "credit" ? balance + parsedAmount : balance - parsedAmount;
  }, [balance, parsedAmount, transactionType]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError("Enter a valid amount.");
      return;
    }
    if (Math.abs(parsedAmount - Number(parsedAmount.toFixed(2))) > 1e-9) {
      setError("Amount can have maximum 2 decimal places.");
      return;
    }
    if (!remarks.trim()) {
      setError("Remarks are required.");
      return;
    }
    if (transactionType === "debit" && balance != null && parsedAmount > balance) {
      setError("Debit cannot exceed the available wallet balance.");
      return;
    }

    const confirmed = window.confirm(
      `${transactionType === "credit" ? "Credit" : "Debit"} ${money(parsedAmount)}?\n\nThis financial ledger entry cannot be edited or deleted.`,
    );
    if (!confirmed) return;

    const fingerprint = JSON.stringify({
      transaction_type: transactionType,
      amount: parsedAmount,
      source,
      remarks: remarks.trim(),
      reference_id: referenceId.trim() || null,
    });
    if (!pendingSubmission.current || pendingSubmission.current.fingerprint !== fingerprint) {
      pendingSubmission.current = {
        fingerprint,
        key: newIdempotencyKey(),
      };
    }

    setPosting(true);
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/wallet`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          transaction_type: transactionType,
          amount: parsedAmount,
          source,
          remarks: remarks.trim(),
          reference_type: referenceId.trim() ? source : null,
          reference_id: referenceId.trim() || null,
          idempotency_key: pendingSubmission.current.key,
        }),
      });
      const data = (await response.json()) as { ok: boolean; error?: string };
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Unable to post wallet transaction.");
      }

      pendingSubmission.current = null;
      setAmount("");
      setRemarks("");
      setReferenceId("");
      setSuccess("Wallet transaction posted successfully.");
      setLoading(true);
      await loadWallet();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to post wallet transaction.");
    } finally {
      setPosting(false);
    }
  }

  return (
    <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Wallet</h2>
          <p className="mt-1 text-sm text-slate-600">
            Credit or debit this user's wallet. Every change is stored in an immutable transaction ledger.
          </p>
        </div>
        <div className="rounded-xl bg-slate-900 px-5 py-3 text-white">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">Current Balance</p>
          <p className="mt-1 text-2xl font-bold">
            {loading && balance == null
              ? "Loading..."
              : balance == null
                ? "Unavailable"
                : money(balance)}
          </p>
        </div>
      </div>

      <form onSubmit={submit} className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm font-semibold text-slate-700">
            Transaction
            <select
              value={transactionType}
              onChange={(event) => setTransactionType(event.target.value as "credit" | "debit")}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900"
              disabled={posting}
            >
              <option value="credit">Credit</option>
              <option value="debit">Debit</option>
            </select>
          </label>

          <label className="text-sm font-semibold text-slate-700">
            Amount (₹)
            <input
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              inputMode="decimal"
              placeholder="0.00"
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900"
              disabled={posting}
            />
          </label>

          <label className="text-sm font-semibold text-slate-700">
            Source
            <select
              value={source}
              onChange={(event) => setSource(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900"
              disabled={posting}
            >
              {SOURCE_OPTIONS[transactionType].map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>

          <label className="text-sm font-semibold text-slate-700">
            Reference ID <span className="font-normal text-slate-400">(optional)</span>
            <input
              value={referenceId}
              onChange={(event) => setReferenceId(event.target.value)}
              placeholder="Winner / refund / usage ref"
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900"
              disabled={posting}
            />
          </label>

          <label className="text-sm font-semibold text-slate-700 md:col-span-2 lg:col-span-3">
            Remarks <span className="text-red-600">*</span>
            <input
              value={remarks}
              onChange={(event) => setRemarks(event.target.value)}
              maxLength={500}
              placeholder="Why is this amount being credited/debited?"
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900"
              disabled={posting}
            />
          </label>

          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Balance After</p>
            <p className={`mt-1 text-lg font-bold ${balanceAfter != null && balanceAfter < 0 ? "text-red-600" : "text-slate-900"}`}>
              {balanceAfter == null ? "—" : money(balanceAfter)}
            </p>
          </div>
        </div>

        {error ? <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p> : null}
        {success ? <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">{success}</p> : null}

        <div className="mt-4 flex justify-end">
          <button
            type="submit"
            disabled={posting || loading || balance == null}
            className="rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {posting ? "Posting..." : transactionType === "credit" ? "Add Credit" : "Add Debit"}
          </button>
        </div>
      </form>

      <div className="mt-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h3 className="font-bold text-slate-900">Transaction Ledger</h3>
            <p className="text-xs text-slate-500">Latest 100 transactions. Ledger entries are not editable or deletable.</p>
          </div>
          <button
            type="button"
            onClick={() => { setLoading(true); void loadWallet(); }}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
          >
            Refresh
          </button>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                {["Date / Time", "Type", "Amount", "Source", "Remarks", "Before", "After", "Created By"].map((label) => (
                  <th key={label} className="whitespace-nowrap px-3 py-2 text-left text-xs font-bold uppercase tracking-wide text-slate-500">{label}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {loading && transactions.length === 0 ? (
                <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-500">Loading wallet...</td></tr>
              ) : balance == null && error ? (
                <tr><td colSpan={8} className="px-3 py-8 text-center font-semibold text-red-600">Wallet data unavailable. Refresh before posting any transaction.</td></tr>
              ) : transactions.length === 0 ? (
                <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-500">No wallet transactions yet.</td></tr>
              ) : (
                transactions.map((tx) => (
                  <tr key={tx.id}>
                    <td className="whitespace-nowrap px-3 py-3 text-slate-600">{dateTime(tx.created_at)}</td>
                    <td className="px-3 py-3">
                      <span className={`rounded-full px-2 py-1 text-xs font-bold ${tx.transaction_type === "credit" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
                        {tx.transaction_type === "credit" ? "Credit" : "Debit"}
                      </span>
                    </td>
                    <td className={`whitespace-nowrap px-3 py-3 font-bold ${tx.transaction_type === "credit" ? "text-emerald-700" : "text-red-700"}`}>
                      {tx.transaction_type === "credit" ? "+" : "-"}{money(tx.amount)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-slate-700">{SOURCE_LABELS[tx.source] ?? tx.source}</td>
                    <td className="min-w-64 px-3 py-3 text-slate-700">{tx.remarks}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-slate-600">{money(tx.balance_before)}</td>
                    <td className="whitespace-nowrap px-3 py-3 font-semibold text-slate-900">{money(tx.balance_after)}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-slate-500">{tx.created_by || "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
