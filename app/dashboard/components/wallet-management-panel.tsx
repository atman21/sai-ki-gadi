"use client";

import { useState } from "react";

import { AdminWalletPanel } from "@/app/dashboard/components/admin-wallet-panel";
import { PhoneNumberAction } from "@/components/admin/phone-number-action";
import { PageHeader } from "@/components/admin/ui/page-header";

type SearchUser = {
  id: string;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  business_name: string | null;
};

export function WalletManagementPanel() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<SearchUser[]>([]);
  const [selected, setSelected] = useState<SearchUser | null>(null);

  async function searchUsers() {
    const q = query.trim();
    if (q.length < 2) {
      setError("Enter at least 2 characters to search.");
      setResults([]);
      return;
    }

    setLoading(true);
    setError(null);
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Wallet Management"
        description="Search a user, view wallet balance, credit or debit with required remarks, and review the immutable ledger. Changes sync to My Wallet in the mobile app."
      />

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <label className="block text-sm font-semibold text-slate-700">
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

        {error ? (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
            {error}
          </p>
        ) : null}

        {results.length > 0 ? (
          <ul className="mt-4 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
            {results.map((user) => {
              const isActive = selected?.id === user.id;
              return (
                <li key={user.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      setSelected(user);
                      setError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelected(user);
                        setError(null);
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
                      className={`flex flex-wrap items-center gap-x-1.5 text-sm ${isActive ? "text-slate-300" : "text-slate-500"}`}
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
                      {!user.phone && !user.business_name
                        ? "No phone / business name"
                        : null}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>

      {selected ? (
        <div className="space-y-3">
          <p className="text-sm font-semibold text-slate-700">
            Selected:{" "}
            <span className="inline-flex flex-wrap items-center gap-x-1.5 text-slate-900">
              <span>{selected.full_name}</span>
              {selected.phone ? (
                <>
                  <span aria-hidden>·</span>
                  <PhoneNumberAction phone={selected.phone} />
                </>
              ) : null}
              {selected.business_name?.trim() ? (
                <>
                  <span aria-hidden>·</span>
                  <span>{selected.business_name.trim()}</span>
                </>
              ) : null}
            </span>
          </p>
          <AdminWalletPanel key={selected.id} userId={selected.id} />
        </div>
      ) : (
        <p className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-500">
          Search and select a user to view balance, post credit/debit, and open the ledger.
        </p>
      )}
    </div>
  );
}
