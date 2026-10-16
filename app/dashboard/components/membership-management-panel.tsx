"use client";

import { FormEvent, useMemo, useState } from "react";

import { PhoneNumberAction } from "@/components/admin/phone-number-action";
import { PageHeader } from "@/components/admin/ui/page-header";
import { formatDateTime } from "@/lib/format-datetime";
import { getMembershipLifecycleStatus } from "@/lib/admin-membership-status";

type SearchUser = {
  id: string;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  business_name: string | null;
  membership_type: string | null;
  membership_started_at: string | null;
  membership_expires_at: string | null;
  membership_duration_days: number | null;
  status: boolean | null;
};

type HistoryRow = {
  id: string;
  membership_type: string;
  starts_at: string | null;
  expires_at: string | null;
  duration_days: number | null;
  amount: number | null;
  payment_reference: string | null;
  payment_status: string;
  status: string;
  source: string;
};

export function MembershipManagementPanel() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expiring, setExpiring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [results, setResults] = useState<SearchUser[]>([]);
  const [selected, setSelected] = useState<SearchUser | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [plan, setPlan] = useState<"gold" | "regular">("regular");
  const [durationDays, setDurationDays] = useState("30");
  const [amount, setAmount] = useState("");
  const [paymentReference, setPaymentReference] = useState("");

  const lifecycle = useMemo(
    () => (selected ? getMembershipLifecycleStatus(selected) : null),
    [selected],
  );

  async function searchUsers() {
    const q = query.trim();
    if (q.length < 2) {
      setError("Enter at least 2 characters to search.");
      setResults([]);
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch(
        `/api/admin/users/search?q=${encodeURIComponent(q)}`,
        { cache: "no-store" },
      );
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        users?: SearchUser[];
      };
      if (!response.ok || data.ok === false) {
        throw new Error(data.error || "Unable to search users.");
      }
      setResults(data.users ?? []);
      if ((data.users ?? []).length === 0) {
        setError("No users matched that search.");
      }
    } catch (err) {
      setResults([]);
      setError(err instanceof Error ? err.message : "Unable to search users.");
    } finally {
      setLoading(false);
    }
  }

  async function loadHistory(userId: string) {
    setHistoryLoading(true);
    try {
      const response = await fetch(
        `/api/admin/users/${encodeURIComponent(userId)}/membership-history`,
        { cache: "no-store" },
      );
      const data = (await response.json()) as {
        history?: HistoryRow[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error || "Unable to load membership history.");
      }
      setHistory(data.history ?? []);
    } catch (err) {
      setHistory([]);
      setError(
        err instanceof Error ? err.message : "Unable to load membership history.",
      );
    } finally {
      setHistoryLoading(false);
    }
  }

  function selectUser(user: SearchUser) {
    setSelected(user);
    setError(null);
    setSuccess(null);
    const isActiveGold =
      user.membership_type === "gold" &&
      getMembershipLifecycleStatus(user) === "Active";
    setPlan(isActiveGold ? "gold" : "regular");
    setDurationDays(
      user.membership_duration_days && user.membership_duration_days > 0
        ? String(user.membership_duration_days)
        : "30",
    );
    setAmount("");
    setPaymentReference("");
    void loadHistory(user.id);
  }

  async function saveMembership(event: FormEvent) {
    event.preventDefault();
    if (!selected || saving) return;

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const days = plan === "gold" ? Number(durationDays) : undefined;
      if (
        plan === "gold" &&
        (!Number.isInteger(days) || (days ?? 0) < 1 || (days ?? 0) > 3660)
      ) {
        throw new Error("Gold duration must be an integer between 1 and 3660 days.");
      }

      const amountValue =
        amount.trim() === "" ? null : Number(amount.trim());
      if (
        amountValue != null &&
        (!Number.isFinite(amountValue) || amountValue < 0)
      ) {
        throw new Error("Enter a valid amount, or leave amount empty.");
      }

      const response = await fetch(
        `/api/admin/users/${encodeURIComponent(selected.id)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            membership_type: plan,
            membership_duration_days: days,
            membership_amount: amountValue,
            membership_payment_reference: paymentReference.trim() || null,
            membership_payment_status:
              amountValue != null ? "paid" : "not_recorded",
          }),
        },
      );
      const data = (await response.json()) as { error?: string; success?: boolean };
      if (!response.ok) {
        throw new Error(data.error || "Failed to update membership.");
      }

      setSuccess(
        plan === "gold"
          ? "Gold membership saved / renewed. History ledger updated."
          : "Membership set to Regular. Active history rows cancelled.",
      );

      // Refresh selected user snapshot from search results + history.
      const refreshed: SearchUser = {
        ...selected,
        membership_type: plan,
        membership_duration_days: plan === "gold" ? (days ?? null) : null,
      };
      setSelected(refreshed);
      setResults((prev) =>
        prev.map((row) => (row.id === refreshed.id ? refreshed : row)),
      );
      await loadHistory(selected.id);

      // Soft refresh of search row fields from API if available.
      const lookup = await fetch(
        `/api/admin/users/search?q=${encodeURIComponent(selected.phone || selected.full_name)}`,
        { cache: "no-store" },
      );
      const lookupData = (await lookup.json()) as { users?: SearchUser[] };
      const match = (lookupData.users ?? []).find((u) => u.id === selected.id);
      if (match) {
        setSelected(match);
        setResults((prev) =>
          prev.map((row) => (row.id === match.id ? match : row)),
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update membership.");
    } finally {
      setSaving(false);
    }
  }

  async function runExpirySweep() {
    if (expiring) return;
    const confirmed = window.confirm(
      "Run membership expiry now?\n\nThis updates expired Gold memberships to Regular and marks history rows as expired. Account ON/OFF status is not changed.",
    );
    if (!confirmed) return;

    setExpiring(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch("/api/admin/memberships/expire", {
        method: "POST",
      });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        expiredCount?: number;
      };
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Expiry sweep failed.");
      }
      setSuccess(
        `Expiry sweep complete. Users updated: ${data.expiredCount ?? 0}.`,
      );
      if (selected) {
        await loadHistory(selected.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Expiry sweep failed.");
    } finally {
      setExpiring(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Membership Management"
        description="Search a user, view plan and expiry, renew or change membership, and review complete history. Account status stays independent from membership expiry."
      />

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <label className="block flex-1 text-sm font-semibold text-slate-700">
            Search by name, mobile, or business name
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void searchUsers();
                  }
                }}
                placeholder="e.g. Ramesh / 98765… / Baba Travels"
                className="h-11 w-full flex-1 rounded-lg border border-slate-300 px-3 text-slate-900"
              />
              <button
                type="button"
                onClick={() => void searchUsers()}
                disabled={loading}
                className="h-11 rounded-lg bg-slate-900 px-5 text-sm font-bold text-white disabled:opacity-50"
              >
                {loading ? "Searching…" : "Search"}
              </button>
            </div>
          </label>

          <button
            type="button"
            onClick={() => void runExpirySweep()}
            disabled={expiring}
            className="h-11 rounded-lg border border-amber-300 bg-amber-50 px-4 text-sm font-bold text-amber-900 disabled:opacity-50"
          >
            {expiring ? "Running expiry…" : "Run expiry sweep now"}
          </button>
        </div>

        {error ? (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
            {error}
          </p>
        ) : null}
        {success ? (
          <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">
            {success}
          </p>
        ) : null}

        {results.length > 0 ? (
          <ul className="mt-4 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
            {results.map((user) => {
              const isActive = selected?.id === user.id;
              const status = getMembershipLifecycleStatus(user);
              return (
                <li key={user.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => selectUser(user)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        selectUser(user);
                      }
                    }}
                    className={`flex w-full cursor-pointer flex-col items-start gap-0.5 px-4 py-3 text-left transition ${
                      isActive
                        ? "bg-slate-900 text-white"
                        : "bg-white text-slate-800 hover:bg-slate-50"
                    }`}
                  >
                    <span className="font-semibold">{user.full_name}</span>
                    <span
                      className={`flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm ${isActive ? "text-slate-300" : "text-slate-500"}`}
                    >
                      {user.phone ? (
                        <span onClick={(e) => e.stopPropagation()}>
                          <PhoneNumberAction
                            phone={user.phone}
                            triggerClassName={
                              isActive
                                ? "text-sky-200 hover:text-white"
                                : undefined
                            }
                          />
                        </span>
                      ) : null}
                      {user.phone && user.business_name ? (
                        <span aria-hidden>·</span>
                      ) : null}
                      {user.business_name ? (
                        <span>{user.business_name}</span>
                      ) : null}
                      {(user.phone || user.business_name) && (
                        <span aria-hidden>·</span>
                      )}
                      <span>Plan: {user.membership_type ?? "regular"}</span>
                      <span aria-hidden>·</span>
                      <span>{status}</span>
                      <span aria-hidden>·</span>
                      <span>
                        Account: {user.status === false ? "OFF" : "ON"}
                      </span>
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>

      {selected ? (
        <div className="grid gap-6 xl:grid-cols-2">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold text-slate-900">Current membership</h2>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-slate-500">User</dt>
                <dd className="font-semibold text-slate-900">{selected.full_name}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Account status</dt>
                <dd className="font-semibold text-slate-900">
                  {selected.status === false ? "OFF" : "ON"}
                  <span className="ml-1 font-normal text-slate-500">
                    (independent of membership)
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Plan</dt>
                <dd className="font-semibold capitalize text-slate-900">
                  {selected.membership_type ?? "regular"}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Lifecycle</dt>
                <dd className="font-semibold text-slate-900">{lifecycle}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Started</dt>
                <dd className="font-semibold text-slate-900">
                  {selected.membership_started_at
                    ? formatDateTime(selected.membership_started_at)
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Expires</dt>
                <dd className="font-semibold text-slate-900">
                  {selected.membership_expires_at
                    ? formatDateTime(selected.membership_expires_at)
                    : "—"}
                </dd>
              </div>
            </dl>

            <form onSubmit={saveMembership} className="mt-6 space-y-4 border-t border-slate-100 pt-5">
              <h3 className="font-bold text-slate-900">Change / renew plan</h3>
              <label className="block text-sm font-semibold text-slate-700">
                Membership plan
                <select
                  value={plan}
                  onChange={(event) =>
                    setPlan(event.target.value as "gold" | "regular")
                  }
                  className="mt-1 h-11 w-full rounded-lg border border-slate-300 bg-white px-3"
                  disabled={saving}
                >
                  <option value="regular">Regular</option>
                  <option value="gold">Gold</option>
                </select>
              </label>

              {plan === "gold" ? (
                <label className="block text-sm font-semibold text-slate-700">
                  Duration (days)
                  <input
                    value={durationDays}
                    onChange={(event) => setDurationDays(event.target.value)}
                    inputMode="numeric"
                    className="mt-1 h-11 w-full rounded-lg border border-slate-300 px-3"
                    disabled={saving}
                  />
                </label>
              ) : null}

              <label className="block text-sm font-semibold text-slate-700">
                Amount received (₹){" "}
                <span className="font-normal text-slate-400">(optional)</span>
                <input
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  inputMode="decimal"
                  placeholder="Leave empty if unknown"
                  className="mt-1 h-11 w-full rounded-lg border border-slate-300 px-3"
                  disabled={saving}
                />
              </label>

              <label className="block text-sm font-semibold text-slate-700">
                Payment reference / UTR{" "}
                <span className="font-normal text-slate-400">(optional)</span>
                <input
                  value={paymentReference}
                  onChange={(event) => setPaymentReference(event.target.value)}
                  className="mt-1 h-11 w-full rounded-lg border border-slate-300 px-3"
                  disabled={saving}
                />
              </label>

              <button
                type="submit"
                disabled={saving}
                className="h-11 w-full rounded-lg bg-slate-900 text-sm font-bold text-white disabled:opacity-50"
              >
                {saving
                  ? "Saving…"
                  : plan === "gold"
                    ? "Save / renew Gold"
                    : "Set Regular"}
              </button>
            </form>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-lg font-bold text-slate-900">Membership history</h2>
              <button
                type="button"
                onClick={() => void loadHistory(selected.id)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
              >
                Refresh
              </button>
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    {[
                      "Plan",
                      "Starts",
                      "Expires",
                      "Days",
                      "Amount",
                      "Payment",
                      "Status",
                      "Source",
                    ].map((label) => (
                      <th
                        key={label}
                        className="whitespace-nowrap px-3 py-2 text-left text-xs font-bold uppercase tracking-wide text-slate-500"
                      >
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {historyLoading ? (
                    <tr>
                      <td colSpan={8} className="px-3 py-8 text-center text-slate-500">
                        Loading history…
                      </td>
                    </tr>
                  ) : history.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-3 py-8 text-center text-slate-500">
                        No membership history yet.
                      </td>
                    </tr>
                  ) : (
                    history.map((row) => (
                      <tr key={row.id}>
                        <td className="whitespace-nowrap px-3 py-3 capitalize">
                          {row.membership_type}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3">
                          {row.starts_at ? formatDateTime(row.starts_at) : "—"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3">
                          {row.expires_at ? formatDateTime(row.expires_at) : "—"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3">
                          {row.duration_days ?? "—"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3">
                          {row.amount == null ? "Unknown" : `₹${row.amount}`}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3">
                          {row.payment_status}
                          {row.payment_reference
                            ? ` · ${row.payment_reference}`
                            : ""}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3">{row.status}</td>
                        <td className="whitespace-nowrap px-3 py-3">
                          {row.source === "legacy_snapshot"
                            ? "Historical snapshot"
                            : row.source}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      ) : (
        <p className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-500">
          Search and select a user to manage membership and view history.
        </p>
      )}
    </div>
  );
}
