"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useAdminAccess } from "@/components/admin/admin-access-provider";
import { auditActionLabel } from "@/lib/admin-audit-labels";

type AuditRow = {
  id: string;
  created_at: string;
  actor_id?: string | null;
  actor_username: string | null;
  actor_display_name: string | null;
  actor_is_super_admin: boolean | null;
  actor_role?: string | null;
  action: string;
  module: string;
  resource_type: string | null;
  resource_id: string | null;
  entity_label?: string | null;
  related_user_id?: string | null;
  description: string;
  success: boolean;
  outcome?: string | null;
  reason?: string | null;
  changed_fields: string[] | null;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  request_id?: string | null;
  ip_address?: string | null;
  user_agent?: string | null;
  http_method?: string | null;
  route_name?: string | null;
};

type AuditSummary = {
  total: number;
  success: number;
  failure: number;
  security: number;
  recent24h: number;
};

const MODULE_OPTIONS = [
  "",
  "auth",
  "security",
  "members",
  "vehicles",
  "profile_changes",
  "wallet",
  "fraud",
  "cities",
  "sliders",
  "winners",
  "content",
  "announcements",
  "fares",
  "fare_overrides",
  "settings",
  "notifications",
  "uploads",
  "administration",
  "audit",
];

function outcomeBadge(row: AuditRow) {
  const outcome = row.outcome || (row.success ? "success" : "failure");
  const styles: Record<string, string> = {
    success: "bg-emerald-100 text-emerald-700",
    failure: "bg-rose-100 text-rose-700",
    partial: "bg-amber-100 text-amber-800",
    pending: "bg-sky-100 text-sky-800",
    rejected: "bg-orange-100 text-orange-800",
  };
  return {
    label: outcome.charAt(0).toUpperCase() + outcome.slice(1),
    className: styles[outcome] ?? "bg-slate-100 text-slate-700",
  };
}

function DiffBlock({
  before,
  after,
  fields,
}: {
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  fields: string[] | null;
}) {
  const keys = useMemo(() => {
    if (fields && fields.length > 0) return fields;
    return Array.from(
      new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]),
    );
  }, [before, after, fields]);

  if (keys.length === 0) {
    return <p className="text-sm text-slate-500">No field-level changes recorded.</p>;
  }

  return (
    <div className="space-y-2">
      {keys.map((key) => (
        <div
          key={key}
          className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs"
        >
          <div className="font-semibold text-slate-700">{key}</div>
          <div className="mt-1 grid gap-2 sm:grid-cols-2">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-slate-500">
                Before
              </div>
              <pre className="mt-0.5 whitespace-pre-wrap break-all text-slate-700">
                {JSON.stringify(before?.[key] ?? null)}
              </pre>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-slate-500">
                After
              </div>
              <pre className="mt-0.5 whitespace-pre-wrap break-all text-slate-700">
                {JSON.stringify(after?.[key] ?? null)}
              </pre>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function AuditLogsPanel() {
  const { can } = useAdminAccess();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<AuditSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [action, setAction] = useState("");
  const [moduleFilter, setModuleFilter] = useState("");
  const [actor, setActor] = useState("");
  const [resourceType, setResourceType] = useState("");
  const [resourceId, setResourceId] = useState("");
  const [relatedUserId, setRelatedUserId] = useState("");
  const [requestId, setRequestId] = useState("");
  const [outcome, setOutcome] = useState("");
  const [successFilter, setSuccessFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<AuditRow | null>(null);
  const [canViewDetails, setCanViewDetails] = useState(false);
  const [canExport, setCanExport] = useState(false);
  const [exporting, setExporting] = useState(false);

  const buildParams = useCallback(
    (opts?: { summary?: boolean; exportCsv?: boolean }) => {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: "40",
      });
      if (opts?.summary) params.set("summary", "1");
      if (opts?.exportCsv) params.set("export", "csv");
      if (q.trim()) params.set("q", q.trim());
      if (action.trim()) params.set("action", action.trim());
      if (moduleFilter.trim()) params.set("module", moduleFilter.trim());
      if (actor.trim()) params.set("actor", actor.trim());
      if (resourceType.trim()) params.set("resourceType", resourceType.trim());
      if (resourceId.trim()) params.set("resourceId", resourceId.trim());
      if (relatedUserId.trim()) params.set("relatedUserId", relatedUserId.trim());
      if (requestId.trim()) params.set("requestId", requestId.trim());
      if (outcome) params.set("outcome", outcome);
      if (successFilter) params.set("success", successFilter);
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      return params;
    },
    [
      page,
      q,
      action,
      moduleFilter,
      actor,
      resourceType,
      resourceId,
      relatedUserId,
      requestId,
      outcome,
      successFilter,
      dateFrom,
      dateTo,
    ],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = buildParams({ summary: true });
      const res = await fetch(`/api/admin/audit-logs?${params}`);
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        data?: AuditRow[];
        total?: number;
        summary?: AuditSummary | null;
        canViewDetails?: boolean;
        canExport?: boolean;
      };
      if (!res.ok || json.ok === false) {
        throw new Error(json.error ?? "Failed to load audit logs.");
      }
      setRows(json.data ?? []);
      setTotal(json.total ?? 0);
      setSummary(json.summary ?? null);
      setCanViewDetails(Boolean(json.canViewDetails));
      setCanExport(Boolean(json.canExport));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
  }, [buildParams]);

  useEffect(() => {
    void load();
  }, [load]);

  const clearFilters = () => {
    setQ("");
    setAction("");
    setModuleFilter("");
    setActor("");
    setResourceType("");
    setResourceId("");
    setRelatedUserId("");
    setRequestId("");
    setOutcome("");
    setSuccessFilter("");
    setDateFrom("");
    setDateTo("");
    setPage(1);
  };

  const exportCsv = async () => {
    if (!canExport) return;
    setExporting(true);
    setError("");
    try {
      const params = buildParams({ exportCsv: true });
      const res = await fetch(`/api/admin/audit-logs?${params}`);
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error ?? "Export failed.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `audit-logs-${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setExporting(false);
    }
  };

  if (!can("audit_logs.view")) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-6 text-sm text-rose-800">
        Access denied. You need the <code>audit_logs.view</code> permission.
      </div>
    );
  }

  const pageSize = 40;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Audit Logs</h2>
          <p className="mt-1 text-sm text-slate-600">
            Immutable activity trail for Admin Panel actions. Actor identity
            comes from the authenticated server session.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Refresh
          </button>
          {canExport ? (
            <button
              type="button"
              disabled={exporting}
              onClick={() => void exportCsv()}
              className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {exporting ? "Exporting…" : "Export CSV"}
            </button>
          ) : null}
        </div>
      </div>

      {summary ? (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {[
            { label: "Total events", value: summary.total, tone: "slate" },
            { label: "Successful", value: summary.success, tone: "emerald" },
            { label: "Failed", value: summary.failure, tone: "rose" },
            { label: "Security events", value: summary.security, tone: "amber" },
            { label: "Last 24 hours", value: summary.recent24h, tone: "sky" },
          ].map((card) => (
            <div
              key={card.label}
              className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
            >
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {card.label}
              </div>
              <div className="mt-1 text-2xl font-bold text-slate-900">
                {card.value.toLocaleString("en-IN")}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {error ? (
        <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </div>
      ) : null}

      <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
          placeholder="Actor name / username"
          value={actor}
          onChange={(e) => {
            setPage(1);
            setActor(e.target.value);
          }}
          className="h-10 rounded-xl border px-3 text-sm"
        />
        <input
          type="text"
          placeholder="Action key (e.g. member_approved)"
          value={action}
          onChange={(e) => {
            setPage(1);
            setAction(e.target.value);
          }}
          className="h-10 rounded-xl border px-3 text-sm"
        />
        <select
          value={moduleFilter}
          onChange={(e) => {
            setPage(1);
            setModuleFilter(e.target.value);
          }}
          className="h-10 rounded-xl border px-3 text-sm"
        >
          <option value="">All modules</option>
          {MODULE_OPTIONS.filter(Boolean).map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Entity type"
          value={resourceType}
          onChange={(e) => {
            setPage(1);
            setResourceType(e.target.value);
          }}
          className="h-10 rounded-xl border px-3 text-sm"
        />
        <input
          type="text"
          placeholder="Entity / resource ID"
          value={resourceId}
          onChange={(e) => {
            setPage(1);
            setResourceId(e.target.value);
          }}
          className="h-10 rounded-xl border px-3 text-sm"
        />
        <input
          type="text"
          placeholder="Related user / driver ID"
          value={relatedUserId}
          onChange={(e) => {
            setPage(1);
            setRelatedUserId(e.target.value);
          }}
          className="h-10 rounded-xl border px-3 text-sm"
        />
        <input
          type="text"
          placeholder="Request / correlation ID"
          value={requestId}
          onChange={(e) => {
            setPage(1);
            setRequestId(e.target.value);
          }}
          className="h-10 rounded-xl border px-3 text-sm"
        />
        <select
          value={outcome}
          onChange={(e) => {
            setPage(1);
            setOutcome(e.target.value);
          }}
          className="h-10 rounded-xl border px-3 text-sm"
        >
          <option value="">All outcomes</option>
          <option value="success">Success</option>
          <option value="failure">Failure</option>
          <option value="partial">Partial</option>
          <option value="pending">Pending</option>
          <option value="rejected">Rejected</option>
        </select>
        <select
          value={successFilter}
          onChange={(e) => {
            setPage(1);
            setSuccessFilter(e.target.value);
          }}
          className="h-10 rounded-xl border px-3 text-sm"
        >
          <option value="">Success flag (all)</option>
          <option value="true">Success = true</option>
          <option value="false">Success = false</option>
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

      <div className="mb-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={clearFilters}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700"
        >
          Clear filters
        </button>
      </div>

      <div className="admin-table-wrap overflow-x-auto">
        <table className="admin-table">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-semibold">When</th>
              <th className="px-4 py-3 text-left text-sm font-semibold">Actor</th>
              <th className="px-4 py-3 text-left text-sm font-semibold">Role</th>
              <th className="px-4 py-3 text-left text-sm font-semibold">
                Module
              </th>
              <th className="px-4 py-3 text-left text-sm font-semibold">
                Action
              </th>
              <th className="px-4 py-3 text-left text-sm font-semibold">
                Affected
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
                <td colSpan={9} className="px-4 py-8 text-center text-slate-500">
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-slate-500">
                  No audit events match your filters.
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const badge = outcomeBadge(row);
                const role =
                  row.actor_role ||
                  (row.actor_is_super_admin ? "super_admin" : "admin");
                const affected =
                  row.entity_label ||
                  [row.resource_type, row.resource_id].filter(Boolean).join(" ") ||
                  "—";
                return (
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
                    <td className="px-4 py-3 text-xs text-slate-600">{role}</td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {row.module}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm font-semibold text-slate-800">
                        {auditActionLabel(row.action)}
                      </div>
                      <div className="font-mono text-[11px] text-slate-500">
                        {row.action}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700 max-w-[12rem]">
                      <div className="truncate" title={affected}>
                        {affected}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-800 max-w-md">
                      <div className="line-clamp-2">{row.description}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold ${badge.className}`}
                      >
                        {badge.label}
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
                );
              })
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
          Page {page} · {total.toLocaleString("en-IN")} total
        </span>
        <button
          type="button"
          disabled={page * pageSize >= total}
          onClick={() => setPage((p) => p + 1)}
          className="rounded-lg border px-3 py-1.5 disabled:opacity-40"
        >
          Next
        </button>
      </div>

      {detail ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-lg font-bold">Audit event</h3>
              <button
                type="button"
                onClick={() => setDetail(null)}
                className="rounded-lg border px-2 py-1 text-sm"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="font-semibold text-slate-500">Description</dt>
                <dd className="break-words">{detail.description}</dd>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <dt className="font-semibold text-slate-500">Actor</dt>
                  <dd>
                    {detail.actor_display_name ||
                      detail.actor_username ||
                      "—"}
                    {detail.actor_username
                      ? ` (@${detail.actor_username})`
                      : ""}
                  </dd>
                </div>
                <div>
                  <dt className="font-semibold text-slate-500">Role</dt>
                  <dd>
                    {detail.actor_role ||
                      (detail.actor_is_super_admin
                        ? "super_admin"
                        : "admin")}
                  </dd>
                </div>
                <div>
                  <dt className="font-semibold text-slate-500">When</dt>
                  <dd>{new Date(detail.created_at).toLocaleString("en-IN")}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-slate-500">Result</dt>
                  <dd>{outcomeBadge(detail).label}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-slate-500">Action</dt>
                  <dd>
                    {auditActionLabel(detail.action)}{" "}
                    <span className="font-mono text-xs text-slate-500">
                      ({detail.action})
                    </span>
                  </dd>
                </div>
                <div>
                  <dt className="font-semibold text-slate-500">Module</dt>
                  <dd>{detail.module}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-slate-500">Affected record</dt>
                  <dd className="break-all">
                    {detail.entity_label || "—"}
                    <div className="text-xs text-slate-500">
                      {[detail.resource_type, detail.resource_id]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </div>
                  </dd>
                </div>
                <div>
                  <dt className="font-semibold text-slate-500">Related user</dt>
                  <dd className="break-all">
                    {detail.related_user_id || "—"}
                  </dd>
                </div>
              </div>
              <div>
                <dt className="font-semibold text-slate-500">Reason / note</dt>
                <dd>{detail.reason || "—"}</dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-500">Request ID</dt>
                <dd className="break-all font-mono text-xs">
                  {detail.request_id || "—"}
                </dd>
              </div>
              {canViewDetails ? (
                <>
                  <div>
                    <dt className="mb-1 font-semibold text-slate-500">
                      Field changes
                    </dt>
                    <dd>
                      <DiffBlock
                        before={detail.before_data}
                        after={detail.after_data}
                        fields={detail.changed_fields}
                      />
                    </dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-slate-500">Metadata</dt>
                    <dd>
                      <pre className="mt-1 max-h-48 overflow-auto rounded-lg bg-slate-50 p-2 text-xs whitespace-pre-wrap break-all">
                        {JSON.stringify(detail.metadata ?? {}, null, 2)}
                      </pre>
                    </dd>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <dt className="font-semibold text-slate-500">IP</dt>
                      <dd>{detail.ip_address || "—"}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-slate-500">
                        HTTP / route
                      </dt>
                      <dd>
                        {[detail.http_method, detail.route_name]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </dd>
                    </div>
                  </div>
                  <div>
                    <dt className="font-semibold text-slate-500">User agent</dt>
                    <dd className="break-all text-xs text-slate-600">
                      {detail.user_agent || "—"}
                    </dd>
                  </div>
                </>
              ) : (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
                  Expanded diffs and sensitive metadata require{" "}
                  <code>audit_logs.view_details</code>.
                </div>
              )}
            </dl>
          </div>
        </div>
      ) : null}
    </div>
  );
}
