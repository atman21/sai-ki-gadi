"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  SKG_APP_MAINTENANCE_LOCALES,
  type AppMaintenanceAllowedNumberRow,
  type AppMaintenanceSettingsRow,
  type MaintenanceTranslation,
} from "@/lib/app-maintenance-admin";
import {
  fromLocalDatetimeInputValue,
  toLocalDatetimeInputValue,
} from "@/lib/maintenance-datetime-admin";

type OwnerRow = {
  user_id: string;
  phone?: string | null;
  description: string | null;
  created_at: string | null;
};

export function AppMaintenanceAdminPanel() {
  const [settings, setSettings] = useState<AppMaintenanceSettingsRow | null>(
    null,
  );
  const [effectiveActive, setEffectiveActive] = useState(false);
  const [allowlist, setAllowlist] = useState<AppMaintenanceAllowedNumberRow[]>(
    [],
  );
  const [owners, setOwners] = useState<OwnerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [newNumber, setNewNumber] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [ownerPhone, setOwnerPhone] = useState("");
  const [ownerDesc, setOwnerDesc] = useState("");
  const [localeEdit, setLocaleEdit] = useState<string>("en");

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [sRes, aRes, oRes] = await Promise.all([
        fetch("/api/admin/app-management/maintenance", {
          credentials: "same-origin",
        }),
        fetch("/api/admin/app-management/maintenance/allowlist", {
          credentials: "same-origin",
        }),
        fetch("/api/admin/app-management/maintenance/owners", {
          credentials: "same-origin",
        }),
      ]);
      const sData = await sRes.json().catch(() => ({}));
      const aData = await aRes.json().catch(() => ({}));
      const oData = await oRes.json().catch(() => ({}));
      if (!sRes.ok || !sData.ok) {
        throw new Error(
          sData.error ||
            "Failed to load maintenance settings (migration may be unapplied).",
        );
      }
      setSettings(sData.settings as AppMaintenanceSettingsRow);
      setEffectiveActive(Boolean(sData.effective_active));
      if (aRes.ok && aData.ok) {
        setAllowlist((aData.items ?? []) as AppMaintenanceAllowedNumberRow[]);
      }
      if (oRes.ok && oData.ok) {
        setOwners((oData.items ?? []) as OwnerRow[]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => {
      void loadAll();
    }, 0);
    return () => window.clearTimeout(t);
  }, [loadAll]);

  const translation = useMemo(() => {
    if (!settings) return { title: "", message: "" };
    const t = settings.translations?.[localeEdit] ?? {};
    return {
      title: t.title ?? "",
      message: t.message ?? "",
    };
  }, [settings, localeEdit]);

  async function saveSettings(
    patch: Partial<AppMaintenanceSettingsRow>,
    confirmMsg?: string,
  ) {
    if (!settings) return;
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/app-management/maintenance", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Save failed.");
      }
      setSettings(data.settings as AppMaintenanceSettingsRow);
      setEffectiveActive(Boolean(data.effective_active));
      setNotice("Maintenance settings saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  async function addAllowlist() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(
        "/api/admin/app-management/maintenance/allowlist",
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mobile_number: newNumber,
            description: newDesc || null,
            is_active: true,
          }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to add number.");
      }
      setNewNumber("");
      setNewDesc("");
      setNotice("Allowlist number added. Takes effect on next Mobile refresh.");
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Add failed.");
    } finally {
      setSaving(false);
    }
  }

  async function updateAllowlist(
    id: string,
    patch: { is_active?: boolean; description?: string | null },
  ) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/app-management/maintenance/allowlist/${id}`,
        {
          method: "PUT",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Update failed.");
      }
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed.");
    } finally {
      setSaving(false);
    }
  }

  async function removeAllowlist(id: string) {
    if (!window.confirm("Remove this number from the allowlist?")) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/app-management/maintenance/allowlist/${id}`,
        { method: "DELETE", credentials: "same-origin" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Delete failed.");
      }
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed.");
    } finally {
      setSaving(false);
    }
  }

  async function addOwner() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        "/api/admin/app-management/maintenance/owners",
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mobile_number: ownerPhone,
            description: ownerDesc || null,
          }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to add owner.");
      }
      setOwnerPhone("");
      setOwnerDesc("");
      setNotice("Owner bypass user added.");
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Add owner failed.");
    } finally {
      setSaving(false);
    }
  }

  async function removeOwner(userId: string) {
    if (!window.confirm("Remove this owner bypass entry?")) return;
    setSaving(true);
    try {
      const res = await fetch(
        `/api/admin/app-management/maintenance/owners?user_id=${encodeURIComponent(userId)}`,
        { method: "DELETE", credentials: "same-origin" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Remove failed.");
      }
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Remove failed.");
    } finally {
      setSaving(false);
    }
  }

  const filteredAllowlist = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allowlist;
    return allowlist.filter(
      (r) =>
        r.normalized_mobile_number.toLowerCase().includes(q) ||
        r.mobile_number.toLowerCase().includes(q) ||
        (r.description || "").toLowerCase().includes(q),
    );
  }, [allowlist, search]);

  if (loading && !settings) {
    return (
      <div className="admin-card p-5" aria-busy="true">
        <p className="admin-eyebrow">App Management</p>
        <h2 className="admin-section-title mt-1">Maintenance Mode</h2>
        <p className="admin-caption mt-2">Loading…</p>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="admin-card p-5">
        <p className="admin-eyebrow">App Management</p>
        <h2 className="admin-section-title mt-1">Maintenance Mode</h2>
        <p className="mt-2 text-sm text-red-600">
          {error || "Settings unavailable."}
        </p>
        <button
          type="button"
          className="admin-btn mt-4"
          onClick={() => void loadAll()}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="admin-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="admin-eyebrow">App Management</p>
            <h2 className="admin-section-title mt-1">Maintenance Mode</h2>
            <p className="admin-caption mt-2 max-w-2xl">
              Remotely control the Mobile App. Allowed verified numbers keep
              full access while others see the Maintenance Screen. Distinct from
              SKG AI emergency stop.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="admin-btn-secondary"
              onClick={() => setPreviewOpen(true)}
            >
              Preview screen
            </button>
            <button
              type="button"
              className="admin-btn-secondary"
              disabled={loading || saving}
              onClick={() => void loadAll()}
            >
              Refresh
            </button>
          </div>
        </div>

        <div
          className={`mt-4 rounded-lg border px-4 py-3 text-sm font-semibold ${
            effectiveActive
              ? "border-amber-300 bg-amber-50 text-amber-900"
              : "border-emerald-300 bg-emerald-50 text-emerald-900"
          }`}
        >
          Effective status:{" "}
          {effectiveActive ? "MAINTENANCE ACTIVE" : "Normal access"}
          {settings.force_emergency ? " (emergency force)" : ""}
        </div>

        {error ? (
          <p className="mt-3 text-sm text-red-600" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="mt-3 text-sm text-emerald-700" role="status">
            {notice}
          </p>
        ) : null}
      </div>

      <div className="admin-card space-y-4 p-5">
        <h3 className="text-base font-semibold text-[var(--admin-text)]">
          Master switches
        </h3>
        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={settings.enabled}
            disabled={saving}
            onChange={(e) =>
              void saveSettings(
                { enabled: e.target.checked },
                e.target.checked
                  ? "Enable Maintenance Mode? Non-allowlisted members will see the Maintenance Screen."
                  : "Disable Maintenance Mode? All members regain normal access.",
              )
            }
          />
          Maintenance enabled
        </label>
        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={settings.force_emergency}
            disabled={saving}
            onChange={(e) =>
              void saveSettings(
                { force_emergency: e.target.checked },
                e.target.checked
                  ? "Enable EMERGENCY maintenance now? This overrides the schedule."
                  : "Clear emergency force?",
              )
            }
          />
          Emergency force (overrides schedule)
        </label>
        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={settings.owner_bypass_enabled}
            disabled={saving}
            onChange={(e) =>
              void saveSettings({ owner_bypass_enabled: e.target.checked })
            }
          />
          Owner/Admin bypass list enabled
        </label>
        <label className="block text-sm">
          Logged-out users
          <select
            className="admin-input mt-1 w-full max-w-xs"
            value={settings.logged_out_policy}
            disabled={saving}
            onChange={(e) =>
              void saveSettings({
                logged_out_policy: e.target.value as "block" | "allow",
              })
            }
          >
            <option value="block">Show maintenance (recommended)</option>
            <option value="allow">Allow auth screens</option>
          </select>
        </label>
      </div>

      <div className="admin-card space-y-4 p-5">
        <h3 className="text-base font-semibold text-[var(--admin-text)]">
          Content & schedule
        </h3>
        <label className="block text-sm">
          Default title (fallback)
          <input
            className="admin-input mt-1 w-full"
            value={settings.title}
            disabled={saving}
            onChange={(e) =>
              setSettings((prev) =>
                prev ? { ...prev, title: e.target.value } : prev,
              )
            }
          />
        </label>
        <label className="block text-sm">
          Default message (fallback)
          <textarea
            className="admin-input mt-1 w-full min-h-[88px]"
            value={settings.message}
            disabled={saving}
            onChange={(e) =>
              setSettings((prev) =>
                prev ? { ...prev, message: e.target.value } : prev,
              )
            }
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            Support contact
            <input
              className="admin-input mt-1 w-full"
              value={settings.support_contact ?? ""}
              disabled={saving}
              onChange={(e) =>
                setSettings((prev) =>
                  prev
                    ? { ...prev, support_contact: e.target.value || null }
                    : prev,
                )
              }
            />
          </label>
          <label className="block text-sm">
            Illustration URL
            <input
              className="admin-input mt-1 w-full"
              value={settings.image_url ?? ""}
              disabled={saving}
              onChange={(e) =>
                setSettings((prev) =>
                  prev
                    ? { ...prev, image_url: e.target.value || null }
                    : prev,
                )
              }
            />
          </label>
        </div>
        <p className="admin-caption">
          Times use your browser&apos;s local timezone, then save as UTC
          (`timestamptz`). Mobile shows them converted to each member&apos;s
          device timezone. Scheduled start/end and expected completion all appear
          on the Maintenance Screen when set.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block text-sm">
            Scheduled start (local)
            <input
              type="datetime-local"
              className="admin-input mt-1 w-full"
              value={toLocalDatetimeInputValue(settings.start_at)}
              disabled={saving}
              onChange={(e) =>
                setSettings((prev) =>
                  prev
                    ? {
                        ...prev,
                        start_at: fromLocalDatetimeInputValue(e.target.value),
                      }
                    : prev,
                )
              }
            />
            {settings.start_at ? (
              <span className="admin-caption mt-1 block font-mono text-[11px]">
                UTC: {settings.start_at}
              </span>
            ) : null}
          </label>
          <label className="block text-sm">
            Scheduled end (local)
            <input
              type="datetime-local"
              className="admin-input mt-1 w-full"
              value={toLocalDatetimeInputValue(settings.end_at)}
              disabled={saving}
              onChange={(e) =>
                setSettings((prev) =>
                  prev
                    ? {
                        ...prev,
                        end_at: fromLocalDatetimeInputValue(e.target.value),
                      }
                    : prev,
                )
              }
            />
            {settings.end_at ? (
              <span className="admin-caption mt-1 block font-mono text-[11px]">
                UTC: {settings.end_at}
              </span>
            ) : null}
          </label>
          <label className="block text-sm">
            Expected completion (local)
            <input
              type="datetime-local"
              className="admin-input mt-1 w-full"
              value={toLocalDatetimeInputValue(settings.expected_return_at)}
              disabled={saving}
              onChange={(e) =>
                setSettings((prev) =>
                  prev
                    ? {
                        ...prev,
                        expected_return_at: fromLocalDatetimeInputValue(
                          e.target.value,
                        ),
                      }
                    : prev,
                )
              }
            />
            {settings.expected_return_at ? (
              <span className="admin-caption mt-1 block font-mono text-[11px]">
                UTC: {settings.expected_return_at}
              </span>
            ) : null}
          </label>
        </div>

        <div className="rounded-lg border border-[var(--admin-border)] p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">Translations</span>
            <select
              className="admin-input"
              value={localeEdit}
              onChange={(e) => setLocaleEdit(e.target.value)}
            >
              {SKG_APP_MAINTENANCE_LOCALES.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <label className="mt-2 block text-sm">
            Title ({localeEdit})
            <input
              className="admin-input mt-1 w-full"
              value={translation.title}
              disabled={saving}
              onChange={(e) => {
                const title = e.target.value;
                setSettings((prev) => {
                  if (!prev) return prev;
                  const translations = {
                    ...prev.translations,
                    [localeEdit]: {
                      ...(prev.translations[localeEdit] ?? {}),
                      title,
                    } satisfies MaintenanceTranslation,
                  };
                  return { ...prev, translations };
                });
              }}
            />
          </label>
          <label className="mt-2 block text-sm">
            Message ({localeEdit})
            <textarea
              className="admin-input mt-1 w-full min-h-[72px]"
              value={translation.message}
              disabled={saving}
              onChange={(e) => {
                const message = e.target.value;
                setSettings((prev) => {
                  if (!prev) return prev;
                  const translations = {
                    ...prev.translations,
                    [localeEdit]: {
                      ...(prev.translations[localeEdit] ?? {}),
                      message,
                    },
                  };
                  return { ...prev, translations };
                });
              }}
            />
          </label>
        </div>

        <button
          type="button"
          className="admin-btn"
          disabled={saving}
          onClick={() =>
            void saveSettings({
              title: settings.title,
              message: settings.message,
              translations: settings.translations,
              image_url: settings.image_url,
              support_contact: settings.support_contact,
              expected_return_at: settings.expected_return_at,
              start_at: settings.start_at,
              end_at: settings.end_at,
            })
          }
        >
          Save content & schedule
        </button>
      </div>

      <div className="admin-card space-y-4 p-5">
        <h3 className="text-base font-semibold text-[var(--admin-text)]">
          Maintenance Allowed Mobile Numbers
        </h3>
        <p className="admin-caption">
          Must match the member&apos;s verified <code>users.phone</code>{" "}
          (+91…). Entering someone else&apos;s number never grants that person
          access.
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            className="admin-input flex-1 min-w-[160px]"
            placeholder="+91 98765 43210"
            value={newNumber}
            onChange={(e) => setNewNumber(e.target.value)}
          />
          <input
            className="admin-input flex-1 min-w-[160px]"
            placeholder="Internal description (optional)"
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
          />
          <button
            type="button"
            className="admin-btn"
            disabled={saving || !newNumber.trim()}
            onClick={() => void addAllowlist()}
          >
            Add number
          </button>
        </div>
        <input
          className="admin-input w-full max-w-md"
          placeholder="Search allowlist…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--admin-border)] text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
                <th className="px-2 py-2">Number</th>
                <th className="px-2 py-2">Status</th>
                <th className="px-2 py-2">Description</th>
                <th className="px-2 py-2">Added</th>
                <th className="px-2 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredAllowlist.length === 0 ? (
                <tr>
                  <td className="px-2 py-4 text-[var(--admin-text-faint)]" colSpan={5}>
                    No allowlist entries.
                  </td>
                </tr>
              ) : (
                filteredAllowlist.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-[var(--admin-border)]"
                  >
                    <td className="px-2 py-2 font-mono text-xs">
                      {row.normalized_mobile_number}
                    </td>
                    <td className="px-2 py-2">
                      {row.is_active ? "Active" : "Inactive"}
                    </td>
                    <td className="px-2 py-2">{row.description || "—"}</td>
                    <td className="px-2 py-2 text-xs">
                      {row.created_at
                        ? new Date(row.created_at).toLocaleString()
                        : "—"}
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="admin-btn-secondary text-xs"
                          disabled={saving}
                          onClick={() =>
                            void updateAllowlist(row.id, {
                              is_active: !row.is_active,
                            })
                          }
                        >
                          {row.is_active ? "Deactivate" : "Activate"}
                        </button>
                        <button
                          type="button"
                          className="admin-btn-secondary text-xs"
                          disabled={saving}
                          onClick={() => void removeAllowlist(row.id)}
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="admin-card space-y-4 p-5">
        <h3 className="text-base font-semibold text-[var(--admin-text)]">
          Owner / Admin bypass (by verified member)
        </h3>
        <p className="admin-caption">
          Independent of the phone allowlist. Resolves{" "}
          <code>users.phone</code> → <code>users.id</code> server-side.
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            className="admin-input flex-1 min-w-[160px]"
            placeholder="Verified mobile"
            value={ownerPhone}
            onChange={(e) => setOwnerPhone(e.target.value)}
          />
          <input
            className="admin-input flex-1 min-w-[160px]"
            placeholder="Description"
            value={ownerDesc}
            onChange={(e) => setOwnerDesc(e.target.value)}
          />
          <button
            type="button"
            className="admin-btn"
            disabled={saving || !ownerPhone.trim()}
            onClick={() => void addOwner()}
          >
            Add owner
          </button>
        </div>
        <ul className="space-y-2 text-sm">
          {owners.length === 0 ? (
            <li className="text-[var(--admin-text-faint)]">No owner entries.</li>
          ) : (
            owners.map((o) => (
              <li
                key={o.user_id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--admin-border)] px-3 py-2"
              >
                <span className="font-mono text-xs">{o.phone || o.user_id}</span>
                <button
                  type="button"
                  className="admin-btn-secondary text-xs"
                  disabled={saving}
                  onClick={() => void removeOwner(o.user_id)}
                >
                  Remove
                </button>
              </li>
            ))
          )}
        </ul>
      </div>

      {previewOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Preview (not live)
            </p>
            <h3 className="mt-3 text-xl font-bold text-[#0F4C81]">
              {settings.title}
            </h3>
            <p className="mt-3 text-sm text-slate-600 whitespace-pre-wrap">
              {settings.message}
            </p>
            {settings.start_at ? (
              <p className="mt-3 text-xs text-slate-500">
                Starts: {new Date(settings.start_at).toLocaleString()}
              </p>
            ) : null}
            {settings.expected_return_at || settings.end_at ? (
              <p className="mt-2 text-xs text-slate-500">
                Expected completion:{" "}
                {new Date(
                  settings.expected_return_at || settings.end_at || "",
                ).toLocaleString()}
              </p>
            ) : null}
            {settings.support_contact ? (
              <p className="mt-2 text-xs text-slate-500">
                Support: {settings.support_contact}
              </p>
            ) : null}
            <button
              type="button"
              className="admin-btn mt-5 w-full"
              onClick={() => setPreviewOpen(false)}
            >
              Close preview
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

