"use client";

import { useCallback, useEffect, useState } from "react";

import { useAdminAccessOptional } from "@/components/admin/admin-access-provider";

type AiSettings = {
  id: number;
  help_center_enabled: boolean;
  voice_enabled: boolean;
  voice_connectivity_verified_at: string | null;
  weekly_allowance_seconds: number;
  max_session_seconds: number;
  lease_seconds: number;
  gemini_model_id: string;
  supported_locales: string[];
  session_resumption_enabled: boolean;
  emergency_disabled: boolean;
  emergency_reason: string | null;
  emergency_disabled_at: string | null;
  emergency_disabled_by: string | null;
  updated_at: string;
};

type AnalyticsPayload = {
  summary: {
    total_sessions: number;
    total_settled_seconds: number;
    total_reserved_seconds: number;
    settled_sessions: number;
    failed_sessions: number;
    active_sessions: number;
    rolling_7d_settled_seconds: number;
    rolling_7d_open_reserved_seconds: number;
    note: string;
  };
  settings: {
    weekly_allowance_seconds: number;
    voice_enabled: boolean;
    emergency_disabled: boolean;
  };
  usage_by_user: Array<{
    user_id: string;
    display_ref: string;
    sessions: number;
    settled_seconds: number;
    reserved_seconds: number;
    failed: number;
    remaining_allowance_seconds: number;
  }>;
  duration_history: Array<{
    id: string;
    status: string;
    settled_seconds: number;
    reserved_seconds: number;
    created_at: string;
    ended_at: string | null;
  }>;
  event_counts: Record<string, number>;
};

type SessionRow = {
  id: string;
  user_id: string;
  user_display_ref: string;
  status: string;
  language: string | null;
  reserved_seconds: number;
  settled_seconds: number;
  started_at: string | null;
  ended_at: string | null;
  end_reason: string | null;
  created_at: string;
};

type SubTab = "settings" | "analytics" | "sessions";

function formatDt(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-IN");
  } catch {
    return iso;
  }
}

function toLocalInputValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function HelpAiPanel() {
  const adminAccess = useAdminAccessOptional();
  const canManage = adminAccess?.can("help_ai.manage") ?? false;

  const [subTab, setSubTab] = useState<SubTab>("settings");
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsPayload | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [sessionTotal, setSessionTotal] = useState(0);
  const [sessionPage, setSessionPage] = useState(1);
  const [sessionStatus, setSessionStatus] = useState("");
  const [sessionDetail, setSessionDetail] = useState<{
    row: SessionRow & Record<string, unknown>;
    events: Array<{
      id: string;
      event_type: string;
      seconds_delta: number;
      created_at: string;
    }>;
  } | null>(null);

  const [weekly, setWeekly] = useState("600");
  const [maxSession, setMaxSession] = useState("120");
  const [lease, setLease] = useState("20");
  const [helpEnabled, setHelpEnabled] = useState(true);
  const [resumption, setResumption] = useState(false);
  const [emergencyReason, setEmergencyReason] = useState("");

  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const [fromInput, setFromInput] = useState(toLocalInputValue(weekAgo));
  const [toInput, setToInput] = useState(toLocalInputValue(now));

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    const res = await fetch("/api/admin/help-ai/settings");
    const json = await res.json();
    if (!res.ok || !json.ok) throw new Error(json.error ?? "Failed to load settings");
    const row = json.row as AiSettings;
    setSettings(row);
    setWeekly(String(row.weekly_allowance_seconds));
    setMaxSession(String(row.max_session_seconds));
    setLease(String(row.lease_seconds));
    setHelpEnabled(row.help_center_enabled);
    setResumption(row.session_resumption_enabled);
  }, []);

  const loadAnalytics = useCallback(async () => {
    const params = new URLSearchParams({
      from: new Date(fromInput).toISOString(),
      to: new Date(toInput).toISOString(),
    });
    const res = await fetch(`/api/admin/help-ai/analytics?${params}`);
    const json = await res.json();
    if (!res.ok || !json.ok) throw new Error(json.error ?? "Failed to load analytics");
    setAnalytics(json as AnalyticsPayload);
  }, [fromInput, toInput]);

  const loadSessions = useCallback(async () => {
    const params = new URLSearchParams({
      page: String(sessionPage),
      pageSize: "20",
      from: new Date(fromInput).toISOString(),
      to: new Date(toInput).toISOString(),
    });
    if (sessionStatus) params.set("status", sessionStatus);
    const res = await fetch(`/api/admin/help-ai/sessions?${params}`);
    const json = await res.json();
    if (!res.ok || !json.ok) throw new Error(json.error ?? "Failed to load sessions");
    setSessions(json.rows ?? []);
    setSessionTotal(json.total ?? 0);
  }, [fromInput, toInput, sessionPage, sessionStatus]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (subTab === "settings") await loadSettings();
      else if (subTab === "analytics") await loadAnalytics();
      else await loadSessions();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [subTab, loadSettings, loadAnalytics, loadSessions]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function verifyConnectivity() {
    if (!canManage) return;
    if (
      !confirm(
        "Run Dev-only Gemini Live connectivity verification? This stamps connectivity on success but does NOT enable voice.",
      )
    ) {
      return;
    }
    setVerifying(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/admin/help-ai/settings/verify-connectivity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        const stepHint =
          json?.probe?.steps && typeof json.probe.steps === "object"
            ? Object.entries(json.probe.steps as Record<string, { status?: string; code?: string | null }>)
                .filter(([, v]) => v?.status === "fail")
                .map(([k, v]) => `${k}:${v.code ?? "fail"}`)
                .join(", ")
            : "";
        throw new Error(
          [json.error ?? "Connectivity verification failed", stepHint]
            .filter(Boolean)
            .join(" — "),
        );
      }
      if (json.row) setSettings(json.row as AiSettings);
      setSuccess(
        "Gemini connectivity verified. voice_connectivity_verified_at stamped. voice_enabled was NOT changed.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connectivity verification failed");
    } finally {
      setVerifying(false);
    }
  }

  async function saveSettings() {
    if (!canManage) return;
    if (
      !confirm(
        "Save AI voice settings? Sensitive changes (allowance / session / resumption) require this confirmation.",
      )
    ) {
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/admin/help-ai/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirm: true,
          help_center_enabled: helpEnabled,
          weekly_allowance_seconds: Number(weekly),
          max_session_seconds: Number(maxSession),
          lease_seconds: Number(lease),
          session_resumption_enabled: resumption,
          // voice_enabled intentionally omitted — do not flip from this form by default
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Save failed");
      setSettings(json.row);
      setSuccess("Settings saved. Voice enablement was not changed.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function emergencyAction(action: "disable" | "enable") {
    if (!canManage) return;
    const msg =
      action === "disable"
        ? "EMERGENCY DISABLE will immediately block new voice sessions and terminate open ones. Continue?"
        : "Clear emergency disable? This does NOT enable voice — voice remains whatever it was before.";
    if (!confirm(msg)) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/admin/help-ai/settings/emergency", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          confirm: true,
          reason: emergencyReason || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Emergency action failed");
      setSuccess(
        action === "disable"
          ? "Emergency disable applied."
          : "Emergency flag cleared (voice unchanged).",
      );
      await loadSettings();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Emergency action failed");
    } finally {
      setSaving(false);
    }
  }

  async function openSession(id: string) {
    setError(null);
    try {
      const res = await fetch(`/api/admin/help-ai/sessions/${id}`);
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Failed to load session");
      setSessionDetail({ row: json.row, events: json.events ?? [] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load session");
    }
  }

  const sessionPages = Math.max(1, Math.ceil(sessionTotal / 20));

  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2">
        {(
          [
            ["settings", "AI Settings"],
            ["analytics", "Usage Analytics"],
            ["sessions", "Session History"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
              subTab === key ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"
            }`}
            onClick={() => {
              setSessionDetail(null);
              setSubTab(key);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {error ? (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}
      {success ? (
        <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {success}
        </p>
      ) : null}

      {subTab === "settings" ? (
        <div className="admin-card p-5">
          {loading || !settings ? (
            <p className="text-slate-500">Loading settings…</p>
          ) : (
            <div className="grid gap-5 max-w-2xl">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                <div>
                  Voice enabled:{" "}
                  <strong>{settings.voice_enabled ? "yes" : "no"}</strong>
                </div>
                <div>
                  Connectivity verified:{" "}
                  <strong>
                    {settings.voice_connectivity_verified_at
                      ? formatDt(settings.voice_connectivity_verified_at)
                      : "not verified"}
                  </strong>
                </div>
                <div>
                  Model: <strong>{settings.gemini_model_id}</strong> (read-only here)
                </div>
                <div>
                  Locales:{" "}
                  <strong>{(settings.supported_locales ?? []).join(", ")}</strong>
                </div>
                <div>
                  Emergency:{" "}
                  <strong
                    className={
                      settings.emergency_disabled ? "text-red-700" : "text-emerald-700"
                    }
                  >
                    {settings.emergency_disabled ? "DISABLED" : "clear"}
                  </strong>
                  {settings.emergency_reason
                    ? ` — ${settings.emergency_reason}`
                    : ""}
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  This form does not enable voice. Use Verify connectivity (Dev) to stamp
                  voice_connectivity_verified_at without enabling voice.
                </p>
                {canManage ? (
                  <button
                    type="button"
                    className="admin-btn mt-3 w-fit"
                    disabled={saving || verifying}
                    onClick={() => void verifyConnectivity()}
                  >
                    {verifying ? "Verifying Gemini…" : "Verify Gemini connectivity (Dev)"}
                  </button>
                ) : null}
              </div>

              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={helpEnabled}
                  disabled={!canManage || saving}
                  onChange={(e) => setHelpEnabled(e.target.checked)}
                />
                <span className="admin-label">Help Center enabled</span>
              </label>

              <label className="block">
                <span className="admin-label">Weekly allowance (seconds, max 600)</span>
                <input
                  className="admin-input mt-1 w-full"
                  value={weekly}
                  disabled={!canManage || saving}
                  onChange={(e) => setWeekly(e.target.value)}
                />
              </label>
              <label className="block">
                <span className="admin-label">Max session duration (seconds, max 120)</span>
                <input
                  className="admin-input mt-1 w-full"
                  value={maxSession}
                  disabled={!canManage || saving}
                  onChange={(e) => setMaxSession(e.target.value)}
                />
              </label>
              <label className="block">
                <span className="admin-label">Lease duration (seconds, 15–30)</span>
                <input
                  className="admin-input mt-1 w-full"
                  value={lease}
                  disabled={!canManage || saving}
                  onChange={(e) => setLease(e.target.value)}
                />
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={resumption}
                  disabled={!canManage || saving}
                  onChange={(e) => setResumption(e.target.checked)}
                />
                <span className="admin-label">
                  Session resumption (privacy-sensitive; default off)
                </span>
              </label>

              {canManage ? (
                <button
                  type="button"
                  className="admin-btn admin-btn-primary w-fit"
                  disabled={saving}
                  onClick={() => void saveSettings()}
                >
                  {saving ? "Saving…" : "Save settings"}
                </button>
              ) : null}

              {canManage ? (
                <div className="mt-4 border-t border-slate-200 pt-4">
                  <h3 className="mb-2 text-base font-bold text-red-800">
                    Emergency controls
                  </h3>
                  <label className="block mb-3">
                    <span className="admin-label">Disable reason</span>
                    <input
                      className="admin-input mt-1 w-full"
                      value={emergencyReason}
                      disabled={saving}
                      onChange={(e) => setEmergencyReason(e.target.value)}
                      placeholder="Optional reason"
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded-xl bg-red-700 px-4 py-2 text-sm font-semibold text-white"
                      disabled={saving || settings.emergency_disabled}
                      onClick={() => void emergencyAction("disable")}
                    >
                      Emergency disable now
                    </button>
                    <button
                      type="button"
                      className="rounded-xl bg-slate-700 px-4 py-2 text-sm font-semibold text-white"
                      disabled={saving || !settings.emergency_disabled}
                      onClick={() => void emergencyAction("enable")}
                    >
                      Clear emergency flag
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      ) : null}

      {subTab === "analytics" ? (
        <div>
          <form
            className="mb-4 flex flex-wrap gap-2 items-end"
            onSubmit={(e) => {
              e.preventDefault();
              void loadAnalytics().catch((err) =>
                setError(err instanceof Error ? err.message : "Failed"),
              );
            }}
          >
            <label className="block">
              <span className="admin-label">From</span>
              <input
                type="datetime-local"
                className="admin-input mt-1"
                value={fromInput}
                onChange={(e) => setFromInput(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="admin-label">To</span>
              <input
                type="datetime-local"
                className="admin-input mt-1"
                value={toInput}
                onChange={(e) => setToInput(e.target.value)}
              />
            </label>
            <button type="submit" className="admin-btn admin-btn-secondary">
              Apply
            </button>
          </form>

          {loading || !analytics ? (
            <p className="text-slate-500">Loading analytics…</p>
          ) : (
            <>
              <p className="mb-3 text-xs text-slate-500">{analytics.summary.note}</p>
              <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  ["Total sessions", analytics.summary.total_sessions],
                  ["Settled seconds", analytics.summary.total_settled_seconds],
                  ["Reserved seconds (not settled)", analytics.summary.total_reserved_seconds],
                  ["Settled sessions", analytics.summary.settled_sessions],
                  ["Failed sessions", analytics.summary.failed_sessions],
                  ["Active / reserved", analytics.summary.active_sessions],
                  ["Rolling 7d settled", analytics.summary.rolling_7d_settled_seconds],
                  [
                    "Rolling 7d open reserved",
                    analytics.summary.rolling_7d_open_reserved_seconds,
                  ],
                ].map(([label, value]) => (
                  <div key={String(label)} className="admin-card p-4">
                    <div className="text-xs uppercase text-slate-500">{label}</div>
                    <div className="mt-1 text-2xl font-bold text-slate-900">{value}</div>
                  </div>
                ))}
              </div>

              <h3 className="mb-2 text-base font-bold text-slate-900">Usage by user</h3>
              <div className="admin-table-wrap mb-6">
                <table className="admin-table">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-bold uppercase">User</th>
                      <th className="px-4 py-3 text-left text-xs font-bold uppercase">Sessions</th>
                      <th className="px-4 py-3 text-left text-xs font-bold uppercase">Settled s</th>
                      <th className="px-4 py-3 text-left text-xs font-bold uppercase">Reserved s</th>
                      <th className="px-4 py-3 text-left text-xs font-bold uppercase">
                        Remaining (7d vs allowance)
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {analytics.usage_by_user.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                          No usage in this range.
                        </td>
                      </tr>
                    ) : (
                      analytics.usage_by_user.map((u) => (
                        <tr key={u.user_id}>
                          <td className="px-4 py-3">{u.display_ref}</td>
                          <td className="px-4 py-3">{u.sessions}</td>
                          <td className="px-4 py-3">{u.settled_seconds}</td>
                          <td className="px-4 py-3">{u.reserved_seconds}</td>
                          <td className="px-4 py-3">{u.remaining_allowance_seconds}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <h3 className="mb-2 text-base font-bold text-slate-900">
                Session duration history
              </h3>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-bold uppercase">Created</th>
                      <th className="px-4 py-3 text-left text-xs font-bold uppercase">Status</th>
                      <th className="px-4 py-3 text-left text-xs font-bold uppercase">Settled</th>
                      <th className="px-4 py-3 text-left text-xs font-bold uppercase">Reserved</th>
                      <th className="px-4 py-3 text-left text-xs font-bold uppercase">Ended</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {analytics.duration_history.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                          No session history yet.
                        </td>
                      </tr>
                    ) : (
                      analytics.duration_history.map((s) => (
                        <tr key={s.id}>
                          <td className="px-4 py-3 text-sm">{formatDt(s.created_at)}</td>
                          <td className="px-4 py-3">{s.status}</td>
                          <td className="px-4 py-3">{s.settled_seconds}</td>
                          <td className="px-4 py-3">{s.reserved_seconds}</td>
                          <td className="px-4 py-3 text-sm">{formatDt(s.ended_at)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      ) : null}

      {subTab === "sessions" ? (
        <div>
          {sessionDetail ? (
            <div className="admin-card p-5 mb-4">
              <div className="mb-3 flex justify-between">
                <h3 className="font-bold text-slate-900">Session detail</h3>
                <button
                  type="button"
                  className="admin-btn admin-btn-secondary"
                  onClick={() => setSessionDetail(null)}
                >
                  Back to list
                </button>
              </div>
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-slate-500">ID</dt>
                  <dd className="font-mono text-xs">{sessionDetail.row.id as string}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">User</dt>
                  <dd>{sessionDetail.row.user_display_ref as string}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Status</dt>
                  <dd>{sessionDetail.row.status as string}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Language</dt>
                  <dd>{(sessionDetail.row.language as string) || "—"}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Reserved seconds</dt>
                  <dd>{String(sessionDetail.row.reserved_seconds)}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Settled seconds</dt>
                  <dd>{String(sessionDetail.row.settled_seconds)}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Started</dt>
                  <dd>{formatDt(sessionDetail.row.started_at as string | null)}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Ended</dt>
                  <dd>{formatDt(sessionDetail.row.ended_at as string | null)}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-slate-500">Failure / end reason</dt>
                  <dd>{(sessionDetail.row.end_reason as string) || "—"}</dd>
                </div>
              </dl>
              <h4 className="mt-4 mb-2 font-semibold">Usage events</h4>
              <ul className="space-y-1 text-sm text-slate-700">
                {sessionDetail.events.length === 0 ? (
                  <li className="text-slate-500">No events.</li>
                ) : (
                  sessionDetail.events.map((ev) => (
                    <li key={ev.id}>
                      {formatDt(ev.created_at)} — {ev.event_type} (
                      {ev.seconds_delta}s)
                    </li>
                  ))
                )}
              </ul>
            </div>
          ) : null}

          <form
            className="mb-4 flex flex-wrap gap-2 items-end"
            onSubmit={(e) => {
              e.preventDefault();
              setSessionPage(1);
              void loadSessions().catch((err) =>
                setError(err instanceof Error ? err.message : "Failed"),
              );
            }}
          >
            <label className="block">
              <span className="admin-label">Status</span>
              <select
                className="admin-input mt-1"
                value={sessionStatus}
                onChange={(e) => setSessionStatus(e.target.value)}
              >
                <option value="">All</option>
                <option value="reserved">reserved</option>
                <option value="active">active</option>
                <option value="ended">ended</option>
                <option value="expired">expired</option>
                <option value="failed">failed</option>
              </select>
            </label>
            <label className="block">
              <span className="admin-label">From</span>
              <input
                type="datetime-local"
                className="admin-input mt-1"
                value={fromInput}
                onChange={(e) => setFromInput(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="admin-label">To</span>
              <input
                type="datetime-local"
                className="admin-input mt-1"
                value={toInput}
                onChange={(e) => setToInput(e.target.value)}
              />
            </label>
            <button type="submit" className="admin-btn admin-btn-secondary">
              Filter
            </button>
          </form>

          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase">Created</th>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase">User</th>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase">Reserved</th>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase">Settled</th>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase">Reason</th>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                      Loading…
                    </td>
                  </tr>
                ) : sessions.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                      No sessions found.
                    </td>
                  </tr>
                ) : (
                  sessions.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 text-sm">{formatDt(row.created_at)}</td>
                      <td className="px-4 py-3">{row.user_display_ref}</td>
                      <td className="px-4 py-3">{row.status}</td>
                      <td className="px-4 py-3">{row.reserved_seconds}</td>
                      <td className="px-4 py-3">{row.settled_seconds}</td>
                      <td className="px-4 py-3 text-sm max-w-[160px] truncate">
                        {row.end_reason || "—"}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          className="rounded bg-slate-100 px-3 py-1 text-slate-700"
                          onClick={() => void openSession(row.id)}
                        >
                          Details
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
            <span>
              Page {sessionPage} of {sessionPages} ({sessionTotal} total)
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                className="admin-btn admin-btn-secondary"
                disabled={sessionPage <= 1}
                onClick={() => setSessionPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </button>
              <button
                type="button"
                className="admin-btn admin-btn-secondary"
                disabled={sessionPage >= sessionPages}
                onClick={() => setSessionPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
