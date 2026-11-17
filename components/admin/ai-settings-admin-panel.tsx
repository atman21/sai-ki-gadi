"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  SKG_AI_ALLOWED_LIVE_MODELS,
  SKG_AI_SETTINGS_BOUNDS,
  SKG_AI_SETTINGS_LOCALES,
  type SkgAiSettingsLocale,
} from "@/lib/ai-settings-admin";

type SettingsView = {
  help_center_enabled: boolean;
  voice_enabled: boolean;
  voice_connectivity_verified_at: string | null;
  weekly_allowance_seconds: number;
  max_session_seconds: number;
  lease_seconds: number;
  gemini_model_id: string;
  supported_locales: string[];
  default_locale: string;
  session_resumption_enabled: boolean;
  emergency_disabled: boolean;
  emergency_reason: string | null;
  emergency_disabled_at: string | null;
  updated_at: string | null;
  updated_by: string | null;
  allowed_models: string[];
  schema_notes?: Record<string, string>;
};

type RelatedInfo = {
  instructions_tab?: string;
  published_fallback_message?: string | null;
  published_scope_preview?: string | null;
};

type EditorState = {
  help_center_enabled: boolean;
  voice_enabled: boolean;
  weekly_allowance_seconds: string;
  max_session_seconds: string;
  lease_seconds: string;
  gemini_model_id: string;
  supported_locales: SkgAiSettingsLocale[];
  default_locale: SkgAiSettingsLocale;
  session_resumption_enabled: boolean;
  mark_voice_connectivity_verified: boolean;
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

function toEditor(settings: SettingsView): EditorState {
  const locales = settings.supported_locales.filter((l): l is SkgAiSettingsLocale =>
    (SKG_AI_SETTINGS_LOCALES as readonly string[]).includes(l),
  );
  const defaultLocale = (
    (SKG_AI_SETTINGS_LOCALES as readonly string[]).includes(settings.default_locale)
      ? settings.default_locale
      : locales[0] ?? "en"
  ) as SkgAiSettingsLocale;

  return {
    help_center_enabled: settings.help_center_enabled,
    voice_enabled: settings.voice_enabled,
    weekly_allowance_seconds: String(settings.weekly_allowance_seconds),
    max_session_seconds: String(settings.max_session_seconds),
    lease_seconds: String(settings.lease_seconds),
    gemini_model_id: settings.gemini_model_id,
    supported_locales: locales.length ? locales : [...SKG_AI_SETTINGS_LOCALES],
    default_locale: defaultLocale,
    session_resumption_enabled: settings.session_resumption_enabled,
    mark_voice_connectivity_verified: false,
  };
}

export function AiSettingsAdminPanel() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [emergencyBusy, setEmergencyBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [related, setRelated] = useState<RelatedInfo | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [emergencyReason, setEmergencyReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/ai-management/settings", {
        credentials: "same-origin",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to load AI settings.");
      }
      const next = data.settings as SettingsView;
      setSettings(next);
      setRelated((data.related as RelatedInfo) ?? null);
      setEditor(toEditor(next));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = useMemo(() => {
    if (!editor || !settings) return false;
    return (
      editor.help_center_enabled !== settings.help_center_enabled ||
      editor.voice_enabled !== settings.voice_enabled ||
      editor.weekly_allowance_seconds !==
        String(settings.weekly_allowance_seconds) ||
      editor.max_session_seconds !== String(settings.max_session_seconds) ||
      editor.lease_seconds !== String(settings.lease_seconds) ||
      editor.gemini_model_id !== settings.gemini_model_id ||
      editor.default_locale !== settings.default_locale ||
      editor.session_resumption_enabled !==
        settings.session_resumption_enabled ||
      editor.mark_voice_connectivity_verified ||
      JSON.stringify(editor.supported_locales) !==
        JSON.stringify(settings.supported_locales)
    );
  }, [editor, settings]);

  function toggleLocale(locale: SkgAiSettingsLocale) {
    setEditor((prev) => {
      if (!prev) return prev;
      const has = prev.supported_locales.includes(locale);
      let nextLocales = has
        ? prev.supported_locales.filter((l) => l !== locale)
        : [...prev.supported_locales, locale];
      if (nextLocales.length === 0) nextLocales = [locale];
      const default_locale = nextLocales.includes(prev.default_locale)
        ? prev.default_locale
        : nextLocales[0];
      return { ...prev, supported_locales: nextLocales, default_locale };
    });
  }

  async function save() {
    if (!editor || !settings) return;

    if (settings.help_center_enabled && !editor.help_center_enabled) {
      const ok = window.confirm(
        "Disable the AI Help Center service? Members will not be able to use SKG AI until it is re-enabled.",
      );
      if (!ok) return;
    }

    if (settings.voice_enabled && !editor.voice_enabled) {
      const ok = window.confirm(
        "Disable Voice AI? New Gemini Live sessions will be rejected until Voice is re-enabled (and connectivity remains verified).",
      );
      if (!ok) return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/ai-management/settings", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          help_center_enabled: editor.help_center_enabled,
          voice_enabled: editor.voice_enabled,
          weekly_allowance_seconds: Number(editor.weekly_allowance_seconds),
          max_session_seconds: Number(editor.max_session_seconds),
          lease_seconds: Number(editor.lease_seconds),
          gemini_model_id: editor.gemini_model_id,
          supported_locales: editor.supported_locales,
          default_locale: editor.default_locale,
          session_resumption_enabled: editor.session_resumption_enabled,
          mark_voice_connectivity_verified:
            editor.mark_voice_connectivity_verified,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to save settings.");
      }
      const next = data.settings as SettingsView;
      setSettings(next);
      setEditor(toEditor(next));
      setNotice("Settings saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  async function runEmergency(action: "disable" | "enable") {
    if (action === "disable") {
      if (!emergencyReason.trim()) {
        setError("Enter a reason before enabling maintenance mode.");
        return;
      }
      const ok = window.confirm(
        "Enable maintenance / emergency disable? Open voice sessions will be terminated and new AI sessions will be blocked.",
      );
      if (!ok) return;
    } else {
      const ok = window.confirm(
        "Clear maintenance / emergency disable and restore AI availability (subject to Help Center / Voice toggles)?",
      );
      if (!ok) return;
    }

    setEmergencyBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/ai-management/settings/emergency", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          reason: emergencyReason.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Emergency action failed.");
      }
      if (data.settings) {
        const next = data.settings as SettingsView;
        setSettings(next);
        setEditor(toEditor(next));
      } else {
        await load();
      }
      setNotice(
        action === "disable"
          ? "Maintenance / emergency disable is active."
          : "Emergency disable cleared.",
      );
      if (action === "enable") setEmergencyReason("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Emergency action failed.");
    } finally {
      setEmergencyBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="admin-card p-5" aria-busy="true">
        <p className="admin-eyebrow">SKG AI Management</p>
        <h2 className="admin-section-title mt-1">AI Settings</h2>
        <p className="admin-caption mt-2">Loading settings…</p>
      </div>
    );
  }

  if (error && !editor) {
    return (
      <div className="admin-card p-5" role="alert">
        <p className="admin-eyebrow">SKG AI Management</p>
        <h2 className="admin-section-title mt-1">AI Settings</h2>
        <p className="mt-2 text-sm text-[var(--admin-danger)]">{error}</p>
        <button type="button" className="admin-btn mt-4" onClick={() => void load()}>
          Retry
        </button>
      </div>
    );
  }

  if (!editor || !settings) return null;

  const models =
    settings.allowed_models?.length > 0
      ? settings.allowed_models
      : [...SKG_AI_ALLOWED_LIVE_MODELS];

  return (
    <div className="space-y-4">
      <div className="admin-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="admin-eyebrow">SKG AI Management</p>
            <h2 className="admin-section-title mt-1">AI Settings</h2>
            <p className="admin-caption mt-2 max-w-3xl">
              Operational controls for Help Center AI and Voice. Values are
              stored in <code>skg_ai_settings</code> and enforced server-side.
              Gemini Live token minting is not modified by this panel.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="admin-btn admin-btn-secondary"
              onClick={() => void load()}
            >
              Refresh
            </button>
            <button
              type="button"
              className="admin-btn admin-btn-primary"
              disabled={saving || !dirty}
              onClick={() => void save()}
            >
              {saving ? "Saving…" : "Save settings"}
            </button>
          </div>
        </div>

        {error ? (
          <p className="mt-3 text-sm text-[var(--admin-danger)]" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="mt-3 text-sm text-[var(--admin-text-secondary)]">
            {notice}
          </p>
        ) : null}

        <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] p-3">
            <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
              Last updated
            </dt>
            <dd className="mt-1 text-sm">{formatWhen(settings.updated_at)}</dd>
          </div>
          <div className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] p-3">
            <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
              Connectivity verified
            </dt>
            <dd className="mt-1 text-sm">
              {formatWhen(settings.voice_connectivity_verified_at)}
            </dd>
          </div>
          <div className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] p-3">
            <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
              Maintenance / emergency
            </dt>
            <dd className="mt-1 text-sm">
              {settings.emergency_disabled ? "Active" : "Off"}
            </dd>
          </div>
        </dl>
      </div>

      <div className="admin-card space-y-4 p-5">
        <h3 className="text-base font-semibold text-[var(--admin-text)]">
          Service availability
        </h3>
        <label className="flex items-start gap-3 rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] p-3">
          <input
            type="checkbox"
            className="mt-1"
            checked={editor.help_center_enabled}
            onChange={(e) =>
              setEditor((prev) =>
                prev
                  ? { ...prev, help_center_enabled: e.target.checked }
                  : prev,
              )
            }
          />
          <span>
            <span className="block text-sm font-medium">
              AI Help Center enabled
            </span>
            <span className="admin-caption">
              Maps to <code>help_center_enabled</code>. When off, mint/reserve
              deny with help_center_disabled.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-3 rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] p-3">
          <input
            type="checkbox"
            className="mt-1"
            checked={editor.voice_enabled}
            onChange={(e) =>
              setEditor((prev) =>
                prev ? { ...prev, voice_enabled: e.target.checked } : prev,
              )
            }
          />
          <span>
            <span className="block text-sm font-medium">Voice AI enabled</span>
            <span className="admin-caption">
              Requires a connectivity verification stamp. Does not change Edge
              Function code or Live audio flow.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-3 rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] p-3">
          <input
            type="checkbox"
            className="mt-1"
            checked={editor.mark_voice_connectivity_verified}
            onChange={(e) =>
              setEditor((prev) =>
                prev
                  ? {
                      ...prev,
                      mark_voice_connectivity_verified: e.target.checked,
                    }
                  : prev,
              )
            }
          />
          <span>
            <span className="block text-sm font-medium">
              Mark voice connectivity verified on save
            </span>
            <span className="admin-caption">
              Sets <code>voice_connectivity_verified_at</code> (audited as
              help_ai.voice_connectivity.verify). Required before enabling Voice
              for the first time.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-3 rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] p-3">
          <input
            type="checkbox"
            className="mt-1"
            checked={editor.session_resumption_enabled}
            onChange={(e) =>
              setEditor((prev) =>
                prev
                  ? {
                      ...prev,
                      session_resumption_enabled: e.target.checked,
                    }
                  : prev,
              )
            }
          />
          <span>
            <span className="block text-sm font-medium">
              Session resumption (privacy-sensitive)
            </span>
            <span className="admin-caption">
              Default off. Enabling is a privacy decision; disabling clears
              stored resumption handles via DB trigger.
            </span>
          </span>
        </label>
      </div>

      <div className="admin-card space-y-4 p-5">
        <h3 className="text-base font-semibold text-[var(--admin-text)]">
          Model & languages
        </h3>
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
            Gemini Live model
          </span>
          <select
            className="admin-input mt-1 w-full max-w-md"
            value={editor.gemini_model_id}
            onChange={(e) =>
              setEditor((prev) =>
                prev ? { ...prev, gemini_model_id: e.target.value } : prev,
              )
            }
          >
            {models.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
          <span className="admin-caption mt-1 block">
            Restricted to the Edge allowlist. Unknown models fail mint with
            model_unavailable.
          </span>
        </label>

        <fieldset>
          <legend className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
            Supported languages
          </legend>
          <div className="mt-2 flex flex-wrap gap-3">
            {SKG_AI_SETTINGS_LOCALES.map((locale) => (
              <label
                key={locale}
                className="flex items-center gap-2 rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] px-3 py-2 text-sm"
              >
                <input
                  type="checkbox"
                  checked={editor.supported_locales.includes(locale)}
                  onChange={() => toggleLocale(locale)}
                />
                {locale === "en"
                  ? "English"
                  : locale === "hi"
                    ? "Hindi"
                    : "Gujarati"}{" "}
                ({locale})
              </label>
            ))}
          </div>
        </fieldset>

        <label className="block max-w-md">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
            Default response language
          </span>
          <select
            className="admin-input mt-1 w-full"
            value={editor.default_locale}
            onChange={(e) =>
              setEditor((prev) =>
                prev
                  ? {
                      ...prev,
                      default_locale: e.target.value as SkgAiSettingsLocale,
                    }
                  : prev,
              )
            }
          >
            {editor.supported_locales.map((locale) => (
              <option key={locale} value={locale}>
                {locale}
              </option>
            ))}
          </select>
          <span className="admin-caption mt-1 block">
            Stored as the first entry of <code>supported_locales</code> (no
            separate default_language column).
          </span>
        </label>
      </div>

      <div className="admin-card space-y-4 p-5">
        <h3 className="text-base font-semibold text-[var(--admin-text)]">
          Usage & session limits
        </h3>
        <p className="admin-caption">
          Server RPCs and mint remain authoritative. Values must stay within DB
          CHECK ceilings.
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
              Weekly allowance (seconds)
            </span>
            <input
              type="number"
              className="admin-input mt-1 w-full"
              min={SKG_AI_SETTINGS_BOUNDS.weekly_allowance_seconds.min}
              max={SKG_AI_SETTINGS_BOUNDS.weekly_allowance_seconds.max}
              value={editor.weekly_allowance_seconds}
              onChange={(e) =>
                setEditor((prev) =>
                  prev
                    ? { ...prev, weekly_allowance_seconds: e.target.value }
                    : prev,
                )
              }
            />
            <span className="admin-caption mt-1 block">
              Max {SKG_AI_SETTINGS_BOUNDS.weekly_allowance_seconds.max}
            </span>
          </label>
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
              Max session (seconds)
            </span>
            <input
              type="number"
              className="admin-input mt-1 w-full"
              min={SKG_AI_SETTINGS_BOUNDS.max_session_seconds.min}
              max={SKG_AI_SETTINGS_BOUNDS.max_session_seconds.max}
              value={editor.max_session_seconds}
              onChange={(e) =>
                setEditor((prev) =>
                  prev
                    ? { ...prev, max_session_seconds: e.target.value }
                    : prev,
                )
              }
            />
            <span className="admin-caption mt-1 block">
              Voice session ceiling ≤{" "}
              {SKG_AI_SETTINGS_BOUNDS.max_session_seconds.max}s
            </span>
          </label>
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
              Lease / heartbeat (seconds)
            </span>
            <input
              type="number"
              className="admin-input mt-1 w-full"
              min={SKG_AI_SETTINGS_BOUNDS.lease_seconds.min}
              max={SKG_AI_SETTINGS_BOUNDS.lease_seconds.max}
              value={editor.lease_seconds}
              onChange={(e) =>
                setEditor((prev) =>
                  prev ? { ...prev, lease_seconds: e.target.value } : prev,
                )
              }
            />
            <span className="admin-caption mt-1 block">
              {SKG_AI_SETTINGS_BOUNDS.lease_seconds.min}–
              {SKG_AI_SETTINGS_BOUNDS.lease_seconds.max}
            </span>
          </label>
        </div>
        <p className="rounded-[var(--admin-radius-sm)] border border-dashed border-[var(--admin-border)] bg-[var(--admin-surface-muted)] p-3 text-sm text-[var(--admin-text-secondary)]">
          Text response / context token limits:{" "}
          <strong>not configured</strong> in schema. Voice limits above are the
          existing safe bounds.
        </p>
      </div>

      <div className="admin-card space-y-3 p-5">
        <h3 className="text-base font-semibold text-[var(--admin-text)]">
          SKG-only scope, fallback & support copy
        </h3>
        <p className="admin-caption">
          These are owned by <strong>AI Instructions</strong> (Phase 2D /
          <code>skg_ai_instructions</code>), not duplicated here, so Gemini Live
          keeps a single published instruction source.
        </p>
        {related?.published_fallback_message ? (
          <p className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] p-3 text-sm">
            <span className="block text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
              Published fallback message
            </span>
            {related.published_fallback_message}
          </p>
        ) : (
          <p className="admin-caption">
            No published instruction fallback found yet.
          </p>
        )}
        {related?.published_scope_preview ? (
          <p className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] p-3 text-sm">
            <span className="block text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
              Published SKG scope (preview)
            </span>
            {related.published_scope_preview}
            {related.published_scope_preview.length >= 280 ? "…" : ""}
          </p>
        ) : null}
        <button
          type="button"
          className="admin-btn admin-btn-secondary"
          onClick={() =>
            router.push(related?.instructions_tab || "/dashboard?tab=ai-instructions")
          }
        >
          Open AI Instructions
        </button>
      </div>

      <div className="admin-card space-y-4 p-5">
        <h3 className="text-base font-semibold text-[var(--admin-text)]">
          Maintenance / temporary AI availability
        </h3>
        <p className="admin-caption">
          Uses <code>emergency_disabled</code> via{" "}
          <code>emergency_terminate_skg_ai_sessions</code>. This is the existing
          kill-switch — not a separate maintenance_mode column.
        </p>
        {settings.emergency_disabled ? (
          <div className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-danger)]/40 bg-[var(--admin-surface-muted)] p-3 text-sm">
            <p className="font-medium text-[var(--admin-danger)]">
              Emergency / maintenance is active
            </p>
            <p className="mt-1 text-[var(--admin-text-secondary)]">
              Reason: {settings.emergency_reason || "—"}
            </p>
            <p className="admin-caption mt-1">
              Since {formatWhen(settings.emergency_disabled_at)}
            </p>
            <button
              type="button"
              className="admin-btn admin-btn-success mt-3"
              disabled={emergencyBusy}
              onClick={() => void runEmergency("enable")}
            >
              {emergencyBusy ? "Working…" : "Clear emergency disable"}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
                Reason (required)
              </span>
              <input
                className="admin-input mt-1 w-full"
                value={emergencyReason}
                onChange={(e) => setEmergencyReason(e.target.value)}
                placeholder="e.g. Planned maintenance — voice temporarily unavailable"
              />
            </label>
            <button
              type="button"
              className="admin-btn admin-btn-danger"
              disabled={emergencyBusy}
              onClick={() => void runEmergency("disable")}
            >
              {emergencyBusy
                ? "Working…"
                : "Enable maintenance / emergency disable"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
