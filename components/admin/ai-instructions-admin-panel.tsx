"use client";

import { useAdminAccess } from "@/components/admin/admin-access-provider";
import {
  composeFinalInstruction,
  SKG_ALLOWED_TOPIC_KEYS,
  SKG_ALLOWED_TOPIC_LABELS,
  type SkgAllowedTopicKey,
} from "@/lib/ai-instructions";
import { useCallback, useEffect, useMemo, useState } from "react";

type InstructionDoc = {
  id: string;
  status: string;
  version: number;
  title: string;
  main_system_instruction: string;
  skg_scope_restriction: string;
  allowed_topics: string[];
  refusal_message: string;
  fallback_message: string;
  language_behavior: string;
  updated_at: string | null;
  updated_by: string | null;
  published_at: string | null;
  published_by: string | null;
  published_version: number | null;
};

type VersionRow = {
  version: number;
  status: string;
  change_reason: string;
  changed_by: string | null;
  created_at: string;
  title: string;
  snapshot: {
    title: string;
    main_system_instruction: string;
    skg_scope_restriction: string;
    allowed_topics: string[];
    refusal_message: string;
    fallback_message: string;
    language_behavior: string;
  };
};

type EditorState = {
  title: string;
  main_system_instruction: string;
  skg_scope_restriction: string;
  allowed_topics: SkgAllowedTopicKey[];
  refusal_message: string;
  fallback_message: string;
  language_behavior: string;
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

function docToEditor(doc: InstructionDoc): EditorState {
  const topics = doc.allowed_topics.filter((t): t is SkgAllowedTopicKey =>
    (SKG_ALLOWED_TOPIC_KEYS as readonly string[]).includes(t),
  );
  return {
    title: doc.title,
    main_system_instruction: doc.main_system_instruction,
    skg_scope_restriction: doc.skg_scope_restriction,
    allowed_topics: topics.length ? topics : [...SKG_ALLOWED_TOPIC_KEYS],
    refusal_message: doc.refusal_message,
    fallback_message: doc.fallback_message,
    language_behavior: doc.language_behavior,
  };
}

export function AiInstructionsAdminPanel() {
  const { can } = useAdminAccess();
  const canManage = can("help_ai.manage");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [draftMeta, setDraftMeta] = useState<InstructionDoc | null>(null);
  const [published, setPublished] = useState<InstructionDoc | null>(null);
  const [previewText, setPreviewText] = useState("");
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [geminiNote, setGeminiNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [mainRes, versionsRes] = await Promise.all([
        fetch("/api/admin/ai-management/instructions", {
          credentials: "same-origin",
        }),
        fetch("/api/admin/ai-management/instructions/versions", {
          credentials: "same-origin",
        }),
      ]);
      const main = await mainRes.json().catch(() => ({}));
      const ver = await versionsRes.json().catch(() => ({}));
      if (!mainRes.ok || !main.ok) {
        throw new Error(main.error || "Failed to load instructions.");
      }
      setDraftMeta(main.draft as InstructionDoc);
      setPublished((main.published as InstructionDoc | null) ?? null);
      setEditor(docToEditor(main.draft as InstructionDoc));
      setPreviewText(String(main.preview_text ?? ""));
      setGeminiNote(
        main.gemini?.reason ??
          "Gemini Live does not yet inject published instructions.",
      );
      if (versionsRes.ok && ver.ok) {
        setVersions(Array.isArray(ver.versions) ? ver.versions : []);
      }
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
    if (!editor || !draftMeta) return false;
    return (
      editor.title !== draftMeta.title ||
      editor.main_system_instruction !== draftMeta.main_system_instruction ||
      editor.skg_scope_restriction !== draftMeta.skg_scope_restriction ||
      editor.refusal_message !== draftMeta.refusal_message ||
      editor.fallback_message !== draftMeta.fallback_message ||
      editor.language_behavior !== draftMeta.language_behavior ||
      JSON.stringify(editor.allowed_topics) !==
        JSON.stringify(draftMeta.allowed_topics)
    );
  }, [editor, draftMeta]);

  const livePreview = useMemo(() => {
    if (!editor) return previewText;
    return composeFinalInstruction(editor);
  }, [editor, previewText]);

  function toggleTopic(key: SkgAllowedTopicKey) {
    if (!canManage || !editor) return;
    setEditor((prev) => {
      if (!prev) return prev;
      const has = prev.allowed_topics.includes(key);
      const next = has
        ? prev.allowed_topics.filter((t) => t !== key)
        : [...prev.allowed_topics, key];
      return { ...prev, allowed_topics: next };
    });
  }

  async function saveDraft() {
    if (!editor || !canManage) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/ai-management/instructions", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editor),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to save draft.");
      }
      setDraftMeta(data.draft as InstructionDoc);
      setEditor(docToEditor(data.draft as InstructionDoc));
      setPreviewText(String(data.preview_text ?? ""));
      setNotice("Draft saved. Not published.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    if (!canManage) return;
    if (dirty) {
      setError("Save the draft before publishing.");
      return;
    }
    setPublishing(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(
        "/api/admin/ai-management/instructions/publish",
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ change_reason: "admin_publish" }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to publish.");
      }
      setNotice(
        `Published v${data.published?.version ?? ""} to Postgres. Staging Edge mint will use this version after deploy.`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Publish failed.");
    } finally {
      setPublishing(false);
    }
  }

  function restoreVersion(row: VersionRow) {
    if (!canManage) return;
    setEditor({
      title: row.snapshot.title,
      main_system_instruction: row.snapshot.main_system_instruction,
      skg_scope_restriction: row.snapshot.skg_scope_restriction,
      allowed_topics: row.snapshot.allowed_topics.filter(
        (t): t is SkgAllowedTopicKey =>
          (SKG_ALLOWED_TOPIC_KEYS as readonly string[]).includes(t),
      ),
      refusal_message: row.snapshot.refusal_message,
      fallback_message: row.snapshot.fallback_message,
      language_behavior: row.snapshot.language_behavior,
    });
    setNotice(
      `Loaded v${row.version} into the editor. Save Draft to keep changes.`,
    );
  }

  if (loading) {
    return (
      <div className="admin-card p-5" aria-busy="true">
        <p className="admin-eyebrow">SKG AI Management</p>
        <h2 className="admin-section-title mt-1">AI Instructions</h2>
        <p className="admin-caption mt-2">Loading instructions…</p>
      </div>
    );
  }

  if (error && !editor) {
    return (
      <div className="admin-card p-5" role="alert">
        <p className="admin-eyebrow">SKG AI Management</p>
        <h2 className="admin-section-title mt-1">AI Instructions</h2>
        <p className="mt-2 text-sm text-[var(--admin-danger)]">{error}</p>
        <button type="button" className="admin-btn mt-4" onClick={() => void load()}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="admin-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="admin-eyebrow">SKG AI Management</p>
            <h2 className="admin-section-title mt-1">AI Instructions</h2>
            <p className="admin-caption mt-2 max-w-3xl">
              Define the official SKG App Assistant system instruction. Draft
              saves never publish. Only the latest published version is loaded
              server-side into Gemini Live systemInstruction (after Staging
              migration + Edge deploy).
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
            {canManage ? (
              <>
                <button
                  type="button"
                  className="admin-btn"
                  disabled={saving || !dirty}
                  onClick={() => void saveDraft()}
                >
                  {saving ? "Saving…" : "Save Draft"}
                </button>
                <button
                  type="button"
                  className="admin-btn admin-btn-primary"
                  disabled={publishing || dirty}
                  onClick={() => void publish()}
                >
                  {publishing ? "Publishing…" : "Publish"}
                </button>
              </>
            ) : (
              <span className="admin-badge admin-badge-neutral">View only</span>
            )}
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

        <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] p-3">
            <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
              Draft version
            </dt>
            <dd className="mt-1 text-sm text-[var(--admin-text)]">
              v{draftMeta?.version ?? "—"}
            </dd>
          </div>
          <div className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] p-3">
            <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
              Last updated
            </dt>
            <dd className="mt-1 text-sm text-[var(--admin-text)]">
              {formatWhen(draftMeta?.updated_at)}
            </dd>
          </div>
          <div className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] p-3">
            <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
              Published version
            </dt>
            <dd className="mt-1 text-sm text-[var(--admin-text)]">
              {published
                ? `v${published.published_version ?? published.version}`
                : "Not published"}
            </dd>
          </div>
          <div className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] p-3">
            <dt className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
              Last published
            </dt>
            <dd className="mt-1 text-sm text-[var(--admin-text)]">
              {formatWhen(published?.published_at)}
            </dd>
          </div>
        </dl>

        {geminiNote ? (
          <p className="mt-4 rounded-[var(--admin-radius-sm)] border border-dashed border-[var(--admin-border)] bg-[var(--admin-surface-muted)] p-3 text-sm text-[var(--admin-text-secondary)]">
            Gemini integration: {geminiNote}
          </p>
        ) : null}
      </div>

      {editor ? (
        <div className="admin-card space-y-4 p-5">
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
              Title
            </span>
            <input
              className="admin-input mt-1 w-full"
              value={editor.title}
              disabled={!canManage}
              onChange={(e) =>
                setEditor((prev) =>
                  prev ? { ...prev, title: e.target.value } : prev,
                )
              }
            />
          </label>

          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
              Main system instruction
            </span>
            <textarea
              className="admin-input mt-1 min-h-[140px] w-full font-mono text-sm"
              value={editor.main_system_instruction}
              disabled={!canManage}
              onChange={(e) =>
                setEditor((prev) =>
                  prev
                    ? { ...prev, main_system_instruction: e.target.value }
                    : prev,
                )
              }
            />
          </label>

          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
              SKG-only scope restriction
            </span>
            <textarea
              className="admin-input mt-1 min-h-[160px] w-full font-mono text-sm"
              value={editor.skg_scope_restriction}
              disabled={!canManage}
              onChange={(e) =>
                setEditor((prev) =>
                  prev
                    ? { ...prev, skg_scope_restriction: e.target.value }
                    : prev,
                )
              }
            />
          </label>

          <fieldset>
            <legend className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
              Allowed topics / categories
            </legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {SKG_ALLOWED_TOPIC_KEYS.map((key) => {
                const checked = editor.allowed_topics.includes(key);
                return (
                  <label
                    key={key}
                    className="flex items-center gap-2 rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] px-3 py-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!canManage}
                      onChange={() => toggleTopic(key)}
                    />
                    <span>{SKG_ALLOWED_TOPIC_LABELS[key]}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
              Refusal message (out of scope)
            </span>
            <textarea
              className="admin-input mt-1 min-h-[90px] w-full"
              value={editor.refusal_message}
              disabled={!canManage}
              onChange={(e) =>
                setEditor((prev) =>
                  prev ? { ...prev, refusal_message: e.target.value } : prev,
                )
              }
            />
          </label>

          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
              Fallback message (knowledge unavailable)
            </span>
            <textarea
              className="admin-input mt-1 min-h-[90px] w-full"
              value={editor.fallback_message}
              disabled={!canManage}
              onChange={(e) =>
                setEditor((prev) =>
                  prev ? { ...prev, fallback_message: e.target.value } : prev,
                )
              }
            />
          </label>

          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
              Language behavior (Gujarati / Hindi / English)
            </span>
            <textarea
              className="admin-input mt-1 min-h-[110px] w-full"
              value={editor.language_behavior}
              disabled={!canManage}
              onChange={(e) =>
                setEditor((prev) =>
                  prev ? { ...prev, language_behavior: e.target.value } : prev,
                )
              }
            />
          </label>
        </div>
      ) : null}

      <div className="admin-card p-5">
        <h3 className="text-base font-semibold text-[var(--admin-text)]">
          Final instruction preview
        </h3>
        <p className="admin-caption mt-1">
          Composed from the current draft fields (includes mandatory SKG policy
          checklist).
        </p>
        <pre className="mt-3 max-h-[420px] overflow-auto whitespace-pre-wrap rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] bg-[var(--admin-surface-muted)] p-3 text-xs leading-relaxed text-[var(--admin-text)]">
          {livePreview || "—"}
        </pre>
      </div>

      <div className="admin-card p-5">
        <h3 className="text-base font-semibold text-[var(--admin-text)]">
          Version history
        </h3>
        {versions.length === 0 ? (
          <p className="admin-caption mt-2">
            No saved versions yet. Save Draft or Publish to create history.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-[var(--admin-border)]">
            {versions.map((row) => (
              <li
                key={`${row.version}-${row.created_at}-${row.status}`}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <div>
                  <p className="text-sm font-medium text-[var(--admin-text)]">
                    v{row.version} · {row.status} · {row.change_reason}
                  </p>
                  <p className="admin-caption">
                    {formatWhen(row.created_at)} · {row.title}
                  </p>
                </div>
                {canManage ? (
                  <button
                    type="button"
                    className="admin-btn admin-btn-secondary"
                    onClick={() => restoreVersion(row)}
                  >
                    Load into editor
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
