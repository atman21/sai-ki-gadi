"use client";

import { useCallback, useEffect, useState } from "react";

import { useAdminAccess } from "@/components/admin/admin-access-provider";

type AuditRow = {
  id: string;
  created_at: string;
  actor_username: string | null;
  actor_display_name: string | null;
  actor_is_super_admin: boolean | null;
  action: string;
  module: string;
  resource_type: string | null;
  resource_id: string | null;
  description: string;
  success: boolean;
  changed_fields: string[] | null;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
};

export function AuditLogsPanel() {
  const { can } = useAdminAccess();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [action, setAction] = useState("");
  const [module, setModule] = useState("");
  const [successFilter, setSuccessFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<AuditRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: "40",
      });
      if (q.trim()) params.set("q", q.trim());
      if (action.trim()) params.set("action", action.trim());
      if (module.trim()) params.set("module", module.trim());
      if (successFilter) params.set("success", successFilter);
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);

      const res = await fetch(`/api/admin/audit-logs?${params}`);
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        data?: AuditRow[];
        total?: number;
      };
      if (!res.ok || json.ok === false) {
        throw new Error(json.error ?? "Failed to load audit logs.");
      }
      setRows(json.data ?? []);
      setTotal(json.total ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
  }, [page, q, action, module, successFilter, dateFrom, dateTo]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!can("audit_logs.view")) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-6 text-sm text-rose-800">
        Access denied. You need the <code>audit_logs.view</code> permission.
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-bold text-slate-900">Audit Logs</h2>
        <p className="mt-1 text-sm text-slate-600">
          Immutable activity trail for Admin Panel actions. Actor identity comes
          from the authenticated server session.
        </p>
      </div>

      {error ? (
        <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </div>
      ) : null}

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <input
          type="search"
          placeholder="Search description, actor, ID…"
          value={q}
          onChange={(e) => {
            setPage(1);
            setQ(e.target.value);
          }}
          className="h-10 rounded-xl border px-3 text-sm"
        />
        <input
          type="text"
          placeholder="Action (e.g. member_approved)"
          value={action}
          onChange={(e) => {
            setPage(1);
            setAction(e.target.value);
          }}
          className="h-10 rounded-xl border px-3 text-sm"
        />
        <input
          type="text"
          placeholder="Module (e.g. members)"
          value={module}
          onChange={(e) => {
            setPage(1);
            setModule(e.target.value);
          }}
          className="h-10 rounded-xl border px-3 text-sm"
        />
        <select
          value={successFilter}
          onChange={(e) => {
            setPage(1);
            setSuccessFilter(e.target.value);
          }}
          className="h-10 rounded-xl border px-3 text-sm"
        >
          <option value="">All results</option>
          <option value="true">Success</option>
          <option value="false">Failure</option>
        </select>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => {
            setPage(1);
            setDateFrom(e.target.value);
          }}
          className="h-10 rounded-xl border px-3 text-sm"
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => {
            setPage(1);
            setDateTo(e.target.value);
          }}
          className="h-10 rounded-xl border px-3 text-sm"
        />
      </div>

      <div className="admin-table-wrap overflow-x-auto">
        <table className="admin-table">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-semibold">When</th>
              <th className="px-4 py-3 text-left text-sm font-semibold">Actor</th>
              <th className="px-4 py-3 text-left text-sm font-semibold">
                Action
              </th>
              <th className="px-4 py-3 text-left text-sm font-semibold">
                Description
              </th>
              <th className="px-4 py-3 text-left text-sm font-semibold">
                Result
              </th>
              <th className="px-4 py-3 text-left text-sm font-semibold">
                Details
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  No audit events match your filters.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">
                    {new Date(row.created_at).toLocaleString("en-IN", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <div className="font-semibold text-slate-800">
                      {row.actor_display_name ||
                        row.actor_username ||
                        "System / unknown"}
                    </div>
                    {row.actor_username ? (
                      <div className="text-xs text-slate-500">
                        @{row.actor_username}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-mono text-xs text-slate-700">
                      {row.action}
                    </div>
                    <div className="text-xs text-slate-500">{row.module}</div>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-800 max-w-md">
                    {row.description}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                        row.success
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-rose-100 text-rose-700"
                      }`}
                    >
                      {row.success ? "Success" : "Failed"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => setDetail(row)}
                      className="rounded-lg bg-indigo-100 px-3 py-1 text-xs font-semibold text-indigo-700"
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
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
          disabled={page * 40 >= total}
          onClick={() => setPage((p) => p + 1)}
          className="rounded-lg border px-3 py-1.5 disabled:opacity-40"
        >
          Next
        </button>
      </div>

      {detail ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-bold">Audit event</h3>
              <button type="button" onClick={() => setDetail(null)}>
                ✕
              </button>
            </div>
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="font-semibold text-slate-500">Description</dt>
                <dd>{detail.description}</dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-500">Actor</dt>
                <dd>
                  {detail.actor_display_name || detail.actor_username || "—"}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-500">Action / Module</dt>
                <dd>
                  {detail.action} · {detail.module}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-500">Resource</dt>
                <dd>
                  {detail.resource_type || "—"} {detail.resource_id || ""}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-500">Changed fields</dt>
                <dd>
                  {(detail.changed_fields ?? []).join(", ") || "—"}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-500">Before</dt>
                <dd>
                  <pre className="mt-1 overflow-x-auto rounded-lg bg-slate-50 p-2 text-xs">
                    {JSON.stringify(detail.before_data, null, 2) || "null"}
                  </pre>
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-500">After</dt>
                <dd>
                  <pre className="mt-1 overflow-x-auto rounded-lg bg-slate-50 p-2 text-xs">
                    {JSON.stringify(detail.after_data, null, 2) || "null"}
                  </pre>
                </dd>
              </div>
            </dl>
          </div>
        </div>
      ) : null}
    </div>
  );
}
