"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { PhoneNumberAction } from "@/components/admin/phone-number-action";
import { VEHICLE_CATEGORIES } from "@/lib/vehicle-categories";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

type UserEmbed = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
} | null;

export type FareOverrideRequestRow = {
  id: string;
  user_id: string;
  from_city: string;
  from_state: string;
  to_city: string;
  to_state: string;
  vehicle_category: string;
  normal_min_fare: number;
  requested_fare: number;
  reason: string | null;
  status: string;
  rejection_reason: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  created_at: string;
  users: UserEmbed | UserEmbed[];
};

type StatusFilter = "pending" | "approved" | "rejected" | "all";

function userEmbed(users: FareOverrideRequestRow["users"]): UserEmbed {
  return Array.isArray(users) ? (users[0] ?? null) : users;
}

function userLabel(users: FareOverrideRequestRow["users"]): string {
  const u = userEmbed(users);
  if (!u) return "Unknown user";
  const name = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
  return name || u.phone || "Unknown user";
}

function formatInr(n: number) {
  return `₹${Number(n).toLocaleString("en-IN")}`;
}

function formatWhen(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function statusBadgeClass(status: string) {
  if (status === "pending") return "bg-amber-100 text-amber-800";
  if (status === "approved") return "bg-emerald-100 text-emerald-700";
  if (status === "rejected") return "bg-rose-100 text-rose-700";
  return "bg-slate-200 text-slate-600";
}

const STATUS_PILLS: { key: StatusFilter; label: string }[] = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "all", label: "All" },
];

export function FareOverrideRequestsPanel() {
  const router = useRouter();
  const [rows, setRows] = useState<FareOverrideRequestRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [q, setQ] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [status, setStatus] = useState<StatusFilter>("pending");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);

  const [review, setReview] = useState<FareOverrideRequestRow | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [approveOpen, setApproveOpen] = useState(false);
  const [allowedFare, setAllowedFare] = useState("");
  const [durationMode, setDurationMode] = useState<"permanent" | "temporary">(
    "permanent",
  );
  const [durationDays, setDurationDays] = useState<7 | 30 | 60 | "custom">(7);
  const [customExpiry, setCustomExpiry] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: "30",
        status,
      });
      if (q.trim()) params.set("q", q.trim());
      if (vehicle) params.set("vehicle", vehicle);
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);

      const res = await fetch(`/api/admin/fare-override-requests?${params}`);
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        data?: FareOverrideRequestRow[];
        total?: number;
      };
      if (!res.ok || json.ok === false) {
        throw new Error(json.error ?? "Failed to load requests.");
      }
      setRows(json.data ?? []);
      setTotal(json.total ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
  }, [page, status, q, vehicle, dateFrom, dateTo]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    const channel = supabase
      .channel("admin-fare-override-requests")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "fare_override_requests" },
        () => {
          void load();
          router.refresh();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load, router]);

  const openReview = (row: FareOverrideRequestRow) => {
    setReview(row);
    setAllowedFare(String(row.requested_fare));
    setDurationMode("permanent");
    setDurationDays(7);
    setCustomExpiry("");
    setRejectReason("");
    setRejectOpen(false);
    setApproveOpen(false);
  };

  const openApprove = (row: FareOverrideRequestRow) => {
    openReview(row);
    setApproveOpen(true);
  };

  const openReject = (row: FareOverrideRequestRow) => {
    openReview(row);
    setRejectOpen(true);
  };

  const doReject = async () => {
    if (!review) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/fare-override-requests/reject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: review.id,
          rejectionReason: rejectReason,
        }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || json.ok === false) {
        throw new Error(json.error ?? "Reject failed.");
      }
      setSuccess("Request rejected. No user override was created.");
      setTimeout(() => setSuccess(""), 3500);
      setReview(null);
      setRejectOpen(false);
      void load();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reject failed.");
    } finally {
      setBusy(false);
    }
  };

  const doApprove = async () => {
    if (!review) return;
    setBusy(true);
    setError("");
    try {
      const payload: Record<string, unknown> = {
        requestId: review.id,
        allowedMinFare: Number(allowedFare),
        permanent: durationMode === "permanent",
      };
      if (durationMode === "temporary") {
        if (durationDays === "custom") {
          payload.expiresAt = customExpiry
            ? new Date(customExpiry).toISOString()
            : null;
        } else {
          payload.durationDays = durationDays;
        }
      }
      const res = await fetch("/api/admin/fare-override-requests/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || json.ok === false) {
        throw new Error(json.error ?? "Approve failed.");
      }
      setSuccess(
        "Approved. User-specific override created — global route minimum unchanged.",
      );
      setTimeout(() => setSuccess(""), 4000);
      setReview(null);
      setApproveOpen(false);
      void load();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Approve failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">
            Minimum Fare Requests
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Users requesting permission to post below the route minimum. Approve
            creates an account-specific override only — global rules stay
            unchanged.
          </p>
        </div>
        <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
          {total} matching
        </span>
      </div>

      {error ? (
        <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </div>
      ) : null}
      {success ? (
        <div className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {success}
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap gap-2">
        {STATUS_PILLS.map((pill) => {
          const active = status === pill.key;
          return (
            <button
              key={pill.key}
              type="button"
              onClick={() => {
                setPage(1);
                setStatus(pill.key);
              }}
              className={`rounded-full px-4 py-2 text-xs font-semibold transition ${
                active
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              {pill.label}
            </button>
          );
        })}
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <input
          type="search"
          placeholder="Search user, phone, city…"
          value={q}
          onChange={(e) => {
            setPage(1);
            setQ(e.target.value);
          }}
          className="h-10 rounded-xl border border-slate-300 px-3 text-sm"
        />
        <select
          value={vehicle}
          onChange={(e) => {
            setPage(1);
            setVehicle(e.target.value);
          }}
          className="h-10 rounded-xl border border-slate-300 px-3 text-sm"
        >
          <option value="">All vehicles</option>
          {VEHICLE_CATEGORIES.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => {
            setPage(1);
            setDateFrom(e.target.value);
          }}
          className="h-10 rounded-xl border border-slate-300 px-3 text-sm"
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => {
            setPage(1);
            setDateTo(e.target.value);
          }}
          className="h-10 rounded-xl border border-slate-300 px-3 text-sm"
        />
      </div>

      <div className="admin-table-wrap">
        <div className="overflow-x-auto">
          <table className="admin-table">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">
                  User
                </th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">
                  Route
                </th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">
                  Vehicle
                </th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">
                  Minimum
                </th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">
                  Requested
                </th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">
                  Reason
                </th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">
                  Status
                </th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">
                  Requested At
                </th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td
                    colSpan={9}
                    className="px-4 py-10 text-center text-slate-500"
                  >
                    Loading…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={9}
                    className="px-4 py-10 text-center text-slate-500"
                  >
                    No minimum fare requests found.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-800">
                        {userLabel(row.users)}
                      </div>
                      <div className="mt-0.5 text-xs text-slate-500">
                        <PhoneNumberAction
                          phone={userEmbed(row.users)?.phone}
                          emptyLabel="—"
                        />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      <div>
                        {row.from_city} → {row.to_city}
                      </div>
                      <div className="mt-0.5 text-xs text-slate-500">
                        {row.from_state} → {row.to_state}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700">
                        {row.vehicle_category}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-900">
                      {formatInr(row.normal_min_fare)}
                    </td>
                    <td className="px-4 py-3 font-semibold text-amber-700">
                      {formatInr(row.requested_fare)}
                    </td>
                    <td className="max-w-[160px] px-4 py-3 text-sm text-slate-600">
                      <span className="line-clamp-2">
                        {row.reason?.trim() || "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${statusBadgeClass(row.status)}`}
                      >
                        {row.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {formatWhen(row.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => openReview(row)}
                          className="rounded-lg bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-200"
                        >
                          View
                        </button>
                        {row.status === "pending" ? (
                          <>
                            <button
                              type="button"
                              onClick={() => openApprove(row)}
                              className="rounded-lg bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-200"
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              onClick={() => openReject(row)}
                              className="rounded-lg bg-rose-100 px-3 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-200"
                            >
                              Reject
                            </button>
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          className="rounded-lg border px-3 py-1.5 disabled:opacity-40"
        >
          Previous
        </button>
        <span>
          Page {page} · {total} total
        </span>
        <button
          type="button"
          disabled={page * 30 >= total}
          onClick={() => setPage((p) => p + 1)}
          className="rounded-lg border px-3 py-1.5 disabled:opacity-40"
        >
          Next
        </button>
      </div>

      {review && !approveOpen && !rejectOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="fare-review-title"
        >
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h3
                id="fare-review-title"
                className="text-xl font-bold text-slate-900"
              >
                Minimum Fare Request
              </h3>
              <button
                type="button"
                onClick={() => setReview(null)}
                className="text-slate-500 hover:text-slate-700"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="font-semibold text-slate-500">User</dt>
                <dd className="text-slate-900">{userLabel(review.users)}</dd>
                <dd className="text-slate-600">
                  <PhoneNumberAction
                    phone={userEmbed(review.users)?.phone}
                    emptyLabel="—"
                  />
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-500">Route</dt>
                <dd className="text-slate-900">
                  {review.from_city}, {review.from_state} → {review.to_city},{" "}
                  {review.to_state}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-500">
                  Vehicle Category
                </dt>
                <dd className="text-slate-900">{review.vehicle_category}</dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-500">
                  Current Minimum Fare
                </dt>
                <dd className="text-slate-900">
                  {formatInr(review.normal_min_fare)}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-500">Requested Fare</dt>
                <dd className="font-semibold text-amber-700">
                  {formatInr(review.requested_fare)}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-500">Reason</dt>
                <dd className="text-slate-900">
                  {review.reason?.trim() || "—"}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-500">Requested At</dt>
                <dd className="text-slate-900">
                  {formatWhen(review.created_at)}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-500">Status</dt>
                <dd className="capitalize text-slate-900">{review.status}</dd>
              </div>
              {review.status === "rejected" && review.rejection_reason ? (
                <div>
                  <dt className="font-semibold text-slate-500">
                    Rejection Reason
                  </dt>
                  <dd className="text-slate-900">{review.rejection_reason}</dd>
                </div>
              ) : null}
            </dl>

            {review.status === "pending" ? (
              <div className="mt-6 flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setRejectOpen(true)}
                  className="flex-1 rounded-xl bg-rose-100 px-4 py-3 text-sm font-semibold text-rose-700 hover:bg-rose-200 disabled:opacity-60"
                >
                  Reject
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setApproveOpen(true)}
                  className="flex-1 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
                >
                  Approve
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {rejectOpen && review ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h4 className="text-lg font-bold text-slate-900">
              Reject this request?
            </h4>
            <p className="mt-2 text-sm text-slate-600">
              {userLabel(review.users)} will not receive a fare override for{" "}
              {review.from_city} → {review.to_city} ({review.vehicle_category}).
            </p>
            <label className="mt-4 block text-sm font-semibold text-slate-700">
              Admin remark (optional)
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={4}
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                placeholder="Optional note for the record…"
              />
            </label>
            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setRejectOpen(false);
                  if (!approveOpen) setReview(null);
                }}
                className="flex-1 rounded-xl border px-4 py-2.5 text-sm font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void doReject()}
                className="flex-1 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
              >
                Confirm Reject
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {approveOpen && review ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
            <h4 className="text-lg font-bold text-slate-900">
              Approve lower fare?
            </h4>
            <p className="mt-2 text-sm text-slate-600">
              Creates a <strong>user-specific</strong> override for{" "}
              {userLabel(review.users)} only. Global minimum for this route stays{" "}
              {formatInr(review.normal_min_fare)}.
            </p>
            <div className="mt-4 space-y-1 text-sm">
              <p>
                <span className="font-semibold">Route:</span> {review.from_city}{" "}
                → {review.to_city} ({review.vehicle_category})
              </p>
              <p>
                <span className="font-semibold">Normal Minimum:</span>{" "}
                {formatInr(review.normal_min_fare)}
              </p>
              <label className="mt-3 block font-semibold text-slate-700">
                Allowed Minimum
                <input
                  type="number"
                  min={1}
                  value={allowedFare}
                  onChange={(e) => setAllowedFare(e.target.value)}
                  className="mt-1 h-10 w-full rounded-xl border border-slate-300 px-3 text-sm"
                />
              </label>
            </div>
            <div className="mt-4">
              <p className="text-sm font-semibold text-slate-700">Duration</p>
              <div className="mt-2 flex gap-3">
                <button
                  type="button"
                  onClick={() => setDurationMode("permanent")}
                  className={`rounded-xl px-3 py-2 text-xs font-semibold ${
                    durationMode === "permanent"
                      ? "bg-indigo-600 text-white"
                      : "bg-slate-100 text-slate-700"
                  }`}
                >
                  Permanent / Until Revoked
                </button>
                <button
                  type="button"
                  onClick={() => setDurationMode("temporary")}
                  className={`rounded-xl px-3 py-2 text-xs font-semibold ${
                    durationMode === "temporary"
                      ? "bg-indigo-600 text-white"
                      : "bg-slate-100 text-slate-700"
                  }`}
                >
                  Temporary
                </button>
              </div>
              {durationMode === "temporary" ? (
                <div className="mt-3 space-y-2">
                  <div className="flex flex-wrap gap-2">
                    {([7, 30, 60] as const).map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setDurationDays(d)}
                        className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                          durationDays === d
                            ? "bg-amber-500 text-white"
                            : "bg-slate-100"
                        }`}
                      >
                        {d} days
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setDurationDays("custom")}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                        durationDays === "custom"
                          ? "bg-amber-500 text-white"
                          : "bg-slate-100"
                      }`}
                    >
                      Custom date
                    </button>
                  </div>
                  {durationDays === "custom" ? (
                    <input
                      type="datetime-local"
                      value={customExpiry}
                      onChange={(e) => setCustomExpiry(e.target.value)}
                      className="h-10 w-full rounded-xl border border-slate-300 px-3 text-sm"
                    />
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setApproveOpen(false);
                  setReview(null);
                }}
                className="flex-1 rounded-xl border px-4 py-2.5 text-sm font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy || !allowedFare.trim()}
                onClick={() => void doApprove()}
                className="flex-1 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
              >
                Confirm Approve
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
