"use client";

import { useAdminAccess } from "@/components/admin/admin-access-provider";
import { useCallback, useEffect, useMemo, useState } from "react";

type UserEmbed = {
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
} | null;

type ReviewRow = {
  id: string;
  reviewer_user_id: string;
  subject_user_id: string;
  rating: number;
  review_text: string;
  status: string;
  created_at: string;
  updated_at: string;
  moderated_at: string | null;
  moderated_by: string | null;
  reviewer: UserEmbed | UserEmbed[];
  subject: UserEmbed | UserEmbed[];
};

type ReportRow = {
  id: string;
  review_id: string;
  reason: string;
  status: string;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  reporter: UserEmbed | UserEmbed[];
  review: {
    id: string;
    rating: number;
    review_text: string;
    status: string;
  } | null;
};

function embed(u: UserEmbed | UserEmbed[]): UserEmbed {
  if (Array.isArray(u)) return u[0] ?? null;
  return u;
}

function personLabel(u: UserEmbed): string {
  if (!u) return "—";
  const name = `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim();
  return name || u.phone || "—";
}

export function MemberReviewsPanel() {
  const adminAccess = useAdminAccess();
  const canModerate = Boolean(adminAccess.can("reviews.moderate"));

  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [ratingFilter, setRatingFilter] = useState<string>("");
  const [q, setQ] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      if (ratingFilter) params.set("rating", ratingFilter);
      if (q.trim()) params.set("q", q.trim());

      const [revRes, repRes] = await Promise.all([
        fetch(`/api/admin/member-reviews?${params.toString()}`, {
          credentials: "include",
        }),
        fetch("/api/admin/member-review-reports?status=open", {
          credentials: "include",
        }),
      ]);

      const revJson = await revRes.json().catch(() => ({}));
      const repJson = await repRes.json().catch(() => ({}));

      if (!revRes.ok) {
        throw new Error(revJson.error || "Failed to load reviews");
      }
      if (!repRes.ok) {
        throw new Error(repJson.error || "Failed to load reports");
      }

      setReviews(Array.isArray(revJson.reviews) ? revJson.reviews : []);
      setReports(Array.isArray(repJson.reports) ? repJson.reports : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setReviews([]);
      setReports([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, ratingFilter, q]);

  useEffect(() => {
    void load();
  }, [load]);

  const openReportCount = useMemo(() => reports.length, [reports]);

  async function moderate(id: string, action: "hide" | "unhide" | "remove") {
    if (!canModerate) return;
    const ok = window.confirm(
      action === "remove"
        ? "Remove this review? The record is retained (status=removed) and will not appear publicly."
        : action === "hide"
          ? "Hide this review from public lists?"
          : "Unhide this review (set status to published)?",
    );
    if (!ok) return;

    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/member-reviews/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        window.alert(json.error || "Moderation failed");
        return;
      }
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function resolveReport(
    id: string,
    status: "resolved" | "dismissed",
  ) {
    if (!canModerate) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/member-review-reports/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        window.alert(json.error || "Failed to update report");
        return;
      }
      await load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm text-slate-700">
          Status
          <select
            className="mt-1 block rounded-lg border border-slate-200 px-3 py-2 text-sm"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All</option>
            <option value="published">Published</option>
            <option value="hidden">Hidden</option>
            <option value="removed">Removed</option>
          </select>
        </label>
        <label className="text-sm text-slate-700">
          Rating
          <select
            className="mt-1 block rounded-lg border border-slate-200 px-3 py-2 text-sm"
            value={ratingFilter}
            onChange={(e) => setRatingFilter(e.target.value)}
          >
            <option value="">All</option>
            {[5, 4, 3, 2, 1].map((n) => (
              <option key={n} value={String(n)}>
                {n}★
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-[220px] flex-1 text-sm text-slate-700">
          Search
          <input
            className="mt-1 block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            placeholder="Name, phone, or review text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
        >
          Refresh
        </button>
      </div>

      {error ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <section>
        <h3 className="mb-3 text-base font-bold text-slate-900">
          Open review reports ({openReportCount})
        </h3>
        <div className="admin-table-wrap">
          <div className="overflow-x-auto">
            <table className="admin-table">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left">Reporter</th>
                  <th className="px-4 py-3 text-left">Reason</th>
                  <th className="px-4 py-3 text-left">Review</th>
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {reports.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-8 text-center text-slate-500"
                    >
                      No open reports.
                    </td>
                  </tr>
                ) : (
                  reports.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        {personLabel(embed(row.reporter))}
                      </td>
                      <td className="px-4 py-3">{row.reason}</td>
                      <td className="px-4 py-3 text-slate-600">
                        {row.review
                          ? `${row.review.rating}★ — ${row.review.review_text.slice(0, 80)}`
                          : row.review_id}
                      </td>
                      <td className="px-4 py-3">
                        {new Date(row.created_at).toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        {canModerate ? (
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              disabled={busyId === row.id}
                              onClick={() =>
                                void resolveReport(row.id, "resolved")
                              }
                              className="rounded bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-800"
                            >
                              Resolve
                            </button>
                            <button
                              type="button"
                              disabled={busyId === row.id}
                              onClick={() =>
                                void resolveReport(row.id, "dismissed")
                              }
                              className="rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700"
                            >
                              Dismiss
                            </button>
                          </div>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-base font-bold text-slate-900">
          Member reviews
        </h3>
        <div className="admin-table-wrap">
          <div className="overflow-x-auto">
            <table className="admin-table">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left">Reviewer</th>
                  <th className="px-4 py-3 text-left">Reviewed member</th>
                  <th className="px-4 py-3 text-left">Rating</th>
                  <th className="px-4 py-3 text-left">Text</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-10 text-center text-slate-500"
                    >
                      Loading…
                    </td>
                  </tr>
                ) : reviews.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-10 text-center text-slate-500"
                    >
                      No member reviews found.
                    </td>
                  </tr>
                ) : (
                  reviews.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        {personLabel(embed(row.reviewer))}
                      </td>
                      <td className="px-4 py-3">
                        {personLabel(embed(row.subject))}
                      </td>
                      <td className="px-4 py-3">{row.rating}★</td>
                      <td className="max-w-xs px-4 py-3 text-slate-700">
                        {row.review_text}
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-slate-700">
                          {row.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {new Date(row.created_at).toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        {canModerate ? (
                          <div className="flex flex-wrap gap-2">
                            {row.status === "published" ? (
                              <button
                                type="button"
                                disabled={busyId === row.id}
                                onClick={() => void moderate(row.id, "hide")}
                                className="rounded bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800"
                              >
                                Hide
                              </button>
                            ) : null}
                            {row.status === "hidden" ? (
                              <button
                                type="button"
                                disabled={busyId === row.id}
                                onClick={() => void moderate(row.id, "unhide")}
                                className="rounded bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-800"
                              >
                                Unhide
                              </button>
                            ) : null}
                            {row.status !== "removed" ? (
                              <button
                                type="button"
                                disabled={busyId === row.id}
                                onClick={() => void moderate(row.id, "remove")}
                                className="rounded bg-red-100 px-2 py-1 text-xs font-semibold text-red-700"
                              >
                                Remove
                              </button>
                            ) : null}
                          </div>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
