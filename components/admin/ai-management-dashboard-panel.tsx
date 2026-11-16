"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

type CountMetric = {
  availability: "available" | "unavailable" | "forbidden";
  value: number | null;
  label?: string;
};

type DashboardPayload = {
  ok: boolean;
  generated_at?: string;
  timezone?: string;
  date_key?: string;
  service_status?: {
    overall: { status: string; label: string };
    connectivity: {
      status: string;
      label: string;
      verified_at: string | null;
    };
    voice: { available: boolean; label: string };
    help_center: { available: boolean; label: string };
    model_id: string | null;
    weekly_allowance_seconds: number | null;
    max_session_seconds: number | null;
    emergency_disabled: boolean | null;
    emergency_reason: string | null;
    settings_updated_at: string | null;
    source: string;
  };
  knowledge?: {
    categories_total: CountMetric;
    categories_active: CountMetric;
    categories_inactive: CountMetric;
    faqs_published: CountMetric;
    faqs_draft: CountMetric;
  };
  usage?: {
    total_sessions: CountMetric;
    successful_sessions: CountMetric;
    failed_sessions: CountMetric;
    expired_sessions: CountMetric;
    open_sessions: CountMetric;
    sessions_today: CountMetric;
    sessions_this_month: CountMetric;
    settled_seconds_today: CountMetric;
    settled_seconds_this_month: CountMetric;
    configured_weekly_allowance_seconds: CountMetric;
    note?: string;
  };
  recent_activity?: Array<{
    at: string | null;
    event: string;
    status: string;
    source: string;
  }>;
  quick_links?: Array<{ key: string; label: string; href: string }>;
  meta?: {
    actor_has_help_view?: boolean;
    live_gemini_probe?: boolean;
    note?: string;
  };
  error?: string;
};

function formatWhen(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatMetric(metric: CountMetric | undefined): string {
  if (!metric) return "Data unavailable";
  if (metric.availability === "forbidden") {
    return metric.label ?? "Permission required";
  }
  if (metric.availability !== "available" || metric.value == null) {
    return metric.label ?? "Data unavailable";
  }
  return String(metric.value);
}

function statusTone(kind: string): string {
  switch (kind) {
    case "enabled":
    case "verified":
    case "success":
    case "ended":
      return "bg-emerald-100 text-emerald-800";
    case "partial":
    case "expired":
    case "reserved":
    case "active":
      return "bg-amber-100 text-amber-900";
    case "disabled":
    case "not_verified":
    case "failure":
    case "failed":
      return "bg-rose-100 text-rose-800";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

function MetricCard({
  title,
  metric,
  hint,
}: {
  title: string;
  metric: CountMetric | undefined;
  hint?: string;
}) {
  return (
    <div className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
        {title}
      </p>
      <p className="mt-2 text-2xl font-bold text-[var(--admin-text)]">
        {formatMetric(metric)}
      </p>
      {hint ? (
        <p className="mt-1 text-xs text-[var(--admin-text-secondary)]">{hint}</p>
      ) : null}
    </div>
  );
}

function StatusPill({
  label,
  tone,
}: {
  label: string;
  tone: string;
}) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone(tone)}`}
    >
      {label}
    </span>
  );
}

export function AiManagementDashboardPanel() {
  const router = useRouter();
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/ai-management/dashboard", {
        credentials: "include",
      });
      const json = (await res.json().catch(() => ({}))) as DashboardPayload;
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Failed to load AI dashboard");
      }
      setData(json);
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : "Failed to load AI dashboard");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="admin-card p-5" aria-busy="true">
        <p className="admin-eyebrow">SKG AI Management</p>
        <h2 className="admin-section-title mt-1">AI Dashboard</h2>
        <p className="admin-caption mt-2">Loading service status and metrics…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="admin-card p-5">
        <p className="admin-eyebrow">SKG AI Management</p>
        <h2 className="admin-section-title mt-1">AI Dashboard</h2>
        <p className="mt-3 text-sm font-medium text-red-700">
          {error ?? "Data unavailable"}
        </p>
        <button
          type="button"
          className="mt-4 h-10 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          onClick={() => void load(true)}
        >
          Retry
        </button>
      </div>
    );
  }

  const status = data.service_status;
  const knowledge = data.knowledge;
  const usage = data.usage;

  return (
    <div className="space-y-4">
      <div className="admin-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="admin-eyebrow">SKG AI Management</p>
            <h2 className="admin-section-title mt-1">AI Dashboard</h2>
            <p className="admin-caption mt-1 max-w-2xl">
              Operational overview from existing T29 settings, FAQ, and voice
              session tables. Times use {data.timezone ?? "Asia/Kolkata"} (
              {data.date_key ?? "—"}).
            </p>
          </div>
          <button
            type="button"
            disabled={refreshing}
            onClick={() => void load(true)}
            className="h-10 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        {data.meta?.note ? (
          <p className="mt-3 text-xs text-slate-500">{data.meta.note}</p>
        ) : null}
      </div>

      {/* A. Service status */}
      <section className="admin-card p-5">
        <h3 className="text-base font-bold text-slate-900">AI Service Status</h3>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Overall
            </p>
            <div className="mt-2">
              <StatusPill
                label={status?.overall.label ?? "Data unavailable"}
                tone={status?.overall.status ?? "unknown"}
              />
            </div>
          </div>
          <div className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Gemini connectivity
            </p>
            <div className="mt-2">
              <StatusPill
                label={status?.connectivity.label ?? "Data unavailable"}
                tone={status?.connectivity.status ?? "unknown"}
              />
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Last verified:{" "}
              {formatWhen(status?.connectivity.verified_at ?? null)}
            </p>
          </div>
          <div className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Voice Assistant
            </p>
            <div className="mt-2">
              <StatusPill
                label={status?.voice.label ?? "Data unavailable"}
                tone={status?.voice.available ? "enabled" : "disabled"}
              />
            </div>
          </div>
          <div className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Help Center
            </p>
            <div className="mt-2">
              <StatusPill
                label={status?.help_center.label ?? "Data unavailable"}
                tone={status?.help_center.available ? "enabled" : "disabled"}
              />
            </div>
          </div>
        </div>
        <dl className="mt-4 grid gap-2 text-sm text-slate-600 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="font-semibold text-slate-500">Model id</dt>
            <dd className="font-mono text-slate-800">
              {status?.model_id || "Not configured"}
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-slate-500">Weekly allowance</dt>
            <dd>
              {status?.weekly_allowance_seconds != null
                ? `${status.weekly_allowance_seconds}s / user / week`
                : "Not configured"}
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-slate-500">Max session</dt>
            <dd>
              {status?.max_session_seconds != null
                ? `${status.max_session_seconds}s`
                : "Not configured"}
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-slate-500">Emergency</dt>
            <dd>
              {status?.emergency_disabled
                ? status.emergency_reason || "Active"
                : "Off"}
            </dd>
          </div>
        </dl>
      </section>

      {/* B. Knowledge */}
      <section className="admin-card p-5">
        <h3 className="text-base font-bold text-slate-900">Knowledge Overview</h3>
        {!data.meta?.actor_has_help_view ? (
          <p className="mt-2 text-sm text-slate-600">
            FAQ metrics require <span className="font-mono">help.view</span>.
          </p>
        ) : null}
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <MetricCard title="Categories" metric={knowledge?.categories_total} />
          <MetricCard title="Active categories" metric={knowledge?.categories_active} />
          <MetricCard
            title="Inactive categories"
            metric={knowledge?.categories_inactive}
          />
          <MetricCard title="Published FAQs" metric={knowledge?.faqs_published} />
          <MetricCard title="Draft FAQs" metric={knowledge?.faqs_draft} />
        </div>
      </section>

      {/* C. Usage */}
      <section className="admin-card p-5">
        <h3 className="text-base font-bold text-slate-900">AI Usage Overview</h3>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard title="Total voice sessions" metric={usage?.total_sessions} />
          <MetricCard
            title="Successful (ended)"
            metric={usage?.successful_sessions}
          />
          <MetricCard title="Failed" metric={usage?.failed_sessions} />
          <MetricCard title="Open now" metric={usage?.open_sessions} />
          <MetricCard title="Sessions today" metric={usage?.sessions_today} />
          <MetricCard
            title="Sessions this month"
            metric={usage?.sessions_this_month}
          />
          <MetricCard
            title="Settled seconds today"
            metric={usage?.settled_seconds_today}
          />
          <MetricCard
            title="Configured weekly allowance"
            metric={usage?.configured_weekly_allowance_seconds}
            hint="Policy from settings — not remaining quota"
          />
        </div>
        {usage?.note ? (
          <p className="mt-3 text-xs text-slate-500">{usage.note}</p>
        ) : null}
      </section>

      {/* D. Recent activity */}
      <section className="admin-card overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-4">
          <h3 className="text-base font-bold text-slate-900">Recent Activity</h3>
          <p className="mt-1 text-xs text-slate-500">
            Admin audit events (help / help_ai) and voice session status changes.
            No conversation content.
          </p>
        </div>
        {(data.recent_activity ?? []).length === 0 ? (
          <p className="px-5 py-6 text-sm text-slate-600">No recent activity.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">When</th>
                  <th className="px-4 py-3">Event</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Source</th>
                </tr>
              </thead>
              <tbody>
                {(data.recent_activity ?? []).map((row, index) => (
                  <tr
                    key={`${row.at ?? "x"}-${row.event}-${index}`}
                    className="border-t border-slate-100"
                  >
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                      {formatWhen(row.at)}
                    </td>
                    <td className="px-4 py-3 text-slate-900">{row.event}</td>
                    <td className="px-4 py-3">
                      <StatusPill label={row.status} tone={row.status} />
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">
                      {row.source}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* E. Quick navigation */}
      <section className="admin-card p-5">
        <h3 className="text-base font-bold text-slate-900">Quick Navigation</h3>
        <p className="mt-1 text-sm text-slate-600">
          Links respect your current permissions.
        </p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {(data.quick_links ?? []).length === 0 ? (
            <p className="text-sm text-slate-600">No authorized AI sections.</p>
          ) : (
            (data.quick_links ?? []).map((link) => (
              <button
                key={link.key}
                type="button"
                onClick={() => router.push(link.href)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-left text-sm font-semibold text-slate-900 hover:border-slate-300 hover:bg-slate-50"
              >
                {link.label}
              </button>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
