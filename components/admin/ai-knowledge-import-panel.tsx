"use client";

import { useAdminAccess } from "@/components/admin/admin-access-provider";
import {
  AI_KNOWLEDGE_LOCALES,
  localeLabel,
  type AiKnowledgeLocale,
} from "@/lib/ai-knowledge-admin";
import { useCallback, useEffect, useRef, useState } from "react";

type CategoryRow = { id: string; key: string; label: string; is_active: boolean };

type ImportJob = {
  id: string;
  status: string;
  original_filename: string;
  format: string;
  byte_size: number;
  preview_text?: string | null;
  extracted_char_count?: number;
  edited_text?: string | null;
  extracted_text?: string | null;
  category_id?: string | null;
  locale?: string | null;
  error_summary?: string | null;
  created_article_ids?: string[];
  uploaded_by?: string | null;
  processed_at?: string | null;
  created_at?: string | null;
  signed_url?: string | null;
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

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function AiKnowledgeImportPanel() {
  const { can } = useAdminAccess();
  const canManage = can("help_ai.manage");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [items, setItems] = useState<ImportJob[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [selected, setSelected] = useState<ImportJob | null>(null);
  const [editedText, setEditedText] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [locale, setLocale] = useState<AiKnowledgeLocale>("en");
  const [busy, setBusy] = useState(false);
  const [splitEnabled, setSplitEnabled] = useState(true);

  const pageSize = 25;

  const loadCategories = useCallback(async () => {
    const res = await fetch("/api/admin/ai-management/knowledge/categories", {
      credentials: "include",
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok && Array.isArray(json.items)) {
      setCategories(json.items.filter((c: CategoryRow) => c.is_active !== false));
    }
  }, []);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("page_size", String(pageSize));
      if (q.trim()) params.set("q", q.trim());
      if (statusFilter) params.set("status", statusFilter);
      const res = await fetch(
        `/api/admin/ai-management/knowledge/imports?${params}`,
        { credentials: "include" },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          json.error ||
            "Failed to load imports (migration/bucket may not be applied).",
        );
      }
      setItems(Array.isArray(json.items) ? json.items : []);
      setTotal(Number(json.total ?? 0));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load imports.");
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page, q, statusFilter]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadCategories();
      void loadList();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadCategories, loadList]);

  const openJob = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/ai-management/knowledge/imports/${id}`,
        { credentials: "include" },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to load job.");
      const item = json.item as ImportJob;
      setSelected(item);
      setEditedText(String(item.edited_text ?? item.extracted_text ?? ""));
      setCategoryId(String(item.category_id ?? categories[0]?.id ?? ""));
      setLocale(
        (item.locale === "hi" || item.locale === "gu" || item.locale === "en"
          ? item.locale
          : "en") as AiKnowledgeLocale,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to open job.");
    } finally {
      setBusy(false);
    }
  };

  const uploadFile = async (file: File) => {
    if (!canManage) return;
    setUploading(true);
    setError(null);
    setMessage(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/admin/ai-management/knowledge/imports", {
        method: "POST",
        credentials: "include",
        body: form,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Upload failed.");
      setMessage(
        json.extraction_ok
          ? `Uploaded and extracted: ${file.name}`
          : `Uploaded but extraction failed: ${json.extraction_error || "unknown"}`,
      );
      await loadList();
      if (json.item?.id) await openJob(String(json.item.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const saveReview = async () => {
    if (!selected || !canManage) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/ai-management/knowledge/imports/${selected.id}/review`,
        {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            edited_text: editedText,
            category_id: categoryId || null,
            locale,
          }),
        },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to save review.");
      setMessage("Review saved.");
      setSelected((prev) =>
        prev
          ? {
              ...prev,
              edited_text: editedText,
              category_id: categoryId,
              locale,
            }
          : prev,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save review failed.");
    } finally {
      setBusy(false);
    }
  };

  const createArticles = async () => {
    if (!selected || !canManage) return;
    if (!categoryId) {
      setError("Select a Knowledge Base category first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await saveReview();
      const res = await fetch(
        `/api/admin/ai-management/knowledge/imports/${selected.id}/create-articles`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            category_id: categoryId,
            locale,
            split: splitEnabled,
          }),
        },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to create articles.");
      const warnings = Array.isArray(json.duplicate_warnings)
        ? json.duplicate_warnings.join(" · ")
        : "";
      setMessage(
        `Created ${json.created_count} draft article(s). Not published.${
          warnings ? ` Warnings: ${warnings}` : ""
        }`,
      );
      await loadList();
      await openJob(selected.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create articles failed.");
    } finally {
      setBusy(false);
    }
  };

  const retryJob = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/ai-management/knowledge/imports/${id}/retry`,
        { method: "POST", credentials: "include" },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) {
        throw new Error(json.error || "Retry failed.");
      }
      setMessage("Retry completed.");
      await loadList();
      await openJob(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Retry failed.");
    } finally {
      setBusy(false);
    }
  };

  const cancelOrDelete = async (id: string, mode: "cancel" | "delete") => {
    if (!canManage) return;
    const ok = window.confirm(
      mode === "delete"
        ? "Permanently delete this import job and stored file?"
        : "Cancel this import job?",
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/ai-management/knowledge/imports/${id}?mode=${mode}`,
        { method: "DELETE", credentials: "include" },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Action failed.");
      setMessage(mode === "delete" ? "Import deleted." : "Import cancelled.");
      if (selected?.id === id) setSelected(null);
      await loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      <div className="admin-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="admin-eyebrow">SKG AI Management</p>
            <h2 className="admin-section-title mt-1">Knowledge Import</h2>
            <p className="admin-caption mt-2 max-w-3xl">
              Upload PDF, DOCX, TXT, or MD into a private bucket, extract text,
              review, then create <strong>draft</strong> Knowledge Base
              articles. Never auto-published. Gemini cannot use imports until
              Phase 3B approve → publish.
            </p>
          </div>
          <button
            type="button"
            className="admin-btn admin-btn-secondary"
            onClick={() => void loadList()}
          >
            Refresh
          </button>
        </div>

        <p className="mt-4 rounded-[var(--admin-radius-sm)] border border-dashed border-[var(--admin-border)] bg-[var(--admin-surface-muted)] p-3 text-sm text-[var(--admin-text-secondary)]">
          Max size 5 MB · Formats PDF/DOCX/TXT/MD · Bucket{" "}
          <code>skg-ai-knowledge-imports</code> (private) · Migration{" "}
          <code>20261116200000_skg_ai_knowledge_import_phase3c.sql</code> must
          be applied on Staging before live uploads work.
        </p>

        {error ? (
          <p className="mt-3 text-sm text-[var(--admin-danger)]" role="alert">
            {error}
          </p>
        ) : null}
        {message ? (
          <p className="mt-3 text-sm text-[var(--admin-text-secondary)]">
            {message}
          </p>
        ) : null}

        {canManage ? (
          <div
            className={`mt-4 rounded-[var(--admin-radius-sm)] border-2 border-dashed p-6 text-center ${
              dragOver
                ? "border-[var(--admin-accent)] bg-[var(--admin-surface-muted)]"
                : "border-[var(--admin-border)]"
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const file = e.dataTransfer.files?.[0];
              if (file) void uploadFile(file);
            }}
          >
            <p className="text-sm font-medium text-[var(--admin-text)]">
              Drag and drop a document here
            </p>
            <p className="admin-caption mt-1">or</p>
            <button
              type="button"
              className="admin-btn admin-btn-primary mt-3"
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
            >
              {uploading ? "Uploading…" : "Upload document"}
            </button>
            <input
              ref={inputRef}
              type="file"
              className="hidden"
              accept=".pdf,.docx,.txt,.md,.markdown,application/pdf,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void uploadFile(file);
              }}
            />
          </div>
        ) : (
          <p className="mt-4 admin-caption">View only — upload requires manage.</p>
        )}

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <input
            className="admin-input"
            placeholder="Search filename…"
            value={q}
            onChange={(e) => {
              setPage(1);
              setQ(e.target.value);
            }}
          />
          <select
            className="admin-input"
            value={statusFilter}
            onChange={(e) => {
              setPage(1);
              setStatusFilter(e.target.value);
            }}
          >
            <option value="">All statuses</option>
            {[
              "uploaded",
              "processing",
              "extracted",
              "failed",
              "cancelled",
              "articles_created",
            ].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="admin-card overflow-x-auto p-0">
          {loading ? (
            <p className="p-5 admin-caption">Loading import jobs…</p>
          ) : items.length === 0 ? (
            <p className="p-5 admin-caption">No import jobs yet.</p>
          ) : (
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-[var(--admin-border)] bg-[var(--admin-surface-muted)] text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
                <tr>
                  <th className="px-3 py-2">File</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Uploaded</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr
                    key={item.id}
                    className="border-b border-[var(--admin-border)] align-top"
                  >
                    <td className="px-3 py-2">
                      <p className="font-medium">{item.original_filename}</p>
                      <p className="admin-caption">
                        {item.format.toUpperCase()} · {formatBytes(item.byte_size)}
                      </p>
                    </td>
                    <td className="px-3 py-2">
                      <span className="admin-badge admin-badge-neutral">
                        {item.status}
                      </span>
                      {item.error_summary ? (
                        <p className="mt-1 text-xs text-[var(--admin-danger)]">
                          {item.error_summary}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">{formatWhen(item.created_at)}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        <button
                          type="button"
                          className="admin-btn admin-btn-secondary"
                          onClick={() => void openJob(item.id)}
                        >
                          Open
                        </button>
                        {canManage &&
                        (item.status === "failed" ||
                          item.status === "uploaded") ? (
                          <button
                            type="button"
                            className="admin-btn admin-btn-secondary"
                            disabled={busy}
                            onClick={() => void retryJob(item.id)}
                          >
                            Retry
                          </button>
                        ) : null}
                        {canManage ? (
                          <button
                            type="button"
                            className="admin-btn admin-btn-ghost"
                            disabled={busy}
                            onClick={() =>
                              void cancelOrDelete(
                                item.id,
                                item.status === "articles_created"
                                  ? "delete"
                                  : "cancel",
                              )
                            }
                          >
                            {item.status === "articles_created"
                              ? "Delete"
                              : "Cancel"}
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="flex items-center justify-between gap-2 p-3">
            <p className="admin-caption">
              Page {page}/{totalPages} · {total} total
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                className="admin-btn admin-btn-secondary"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </button>
              <button
                type="button"
                className="admin-btn admin-btn-secondary"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          </div>
        </div>

        <div className="admin-card space-y-3 p-5">
          {!selected ? (
            <p className="admin-caption">
              Select an import job to preview extracted text and create draft
              articles.
            </p>
          ) : (
            <>
              <div>
                <h3 className="text-base font-semibold">
                  {selected.original_filename}
                </h3>
                <p className="admin-caption">
                  Status {selected.status} · chars{" "}
                  {selected.extracted_char_count ?? 0} · processed{" "}
                  {formatWhen(selected.processed_at)}
                </p>
                {selected.signed_url ? (
                  <a
                    className="mt-1 inline-block text-sm underline"
                    href={selected.signed_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open private signed URL (1h)
                  </a>
                ) : null}
              </div>

              {selected.error_summary ? (
                <p className="text-sm text-[var(--admin-danger)]">
                  {selected.error_summary}
                </p>
              ) : null}

              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
                  Extracted / edited text (untrusted)
                </span>
                <textarea
                  className="admin-input mt-1 min-h-[220px] w-full font-mono text-xs"
                  value={editedText}
                  disabled={!canManage || busy}
                  onChange={(e) => setEditedText(e.target.value)}
                />
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
                    Category
                  </span>
                  <select
                    className="admin-input mt-1 w-full"
                    value={categoryId}
                    disabled={!canManage}
                    onChange={(e) => setCategoryId(e.target.value)}
                  >
                    <option value="">Select…</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
                    Language
                  </span>
                  <select
                    className="admin-input mt-1 w-full"
                    value={locale}
                    disabled={!canManage}
                    onChange={(e) =>
                      setLocale(e.target.value as AiKnowledgeLocale)
                    }
                  >
                    {AI_KNOWLEDGE_LOCALES.map((l) => (
                      <option key={l} value={l}>
                        {localeLabel(l)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={splitEnabled}
                  disabled={!canManage}
                  onChange={(e) => setSplitEnabled(e.target.checked)}
                />
                Split into multiple articles by <code>---</code> or Markdown
                headings
              </label>

              {canManage ? (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="admin-btn"
                    disabled={busy}
                    onClick={() => void saveReview()}
                  >
                    Save review
                  </button>
                  <button
                    type="button"
                    className="admin-btn admin-btn-primary"
                    disabled={
                      busy ||
                      (selected.status !== "extracted" &&
                        selected.status !== "articles_created")
                    }
                    onClick={() => void createArticles()}
                  >
                    Create draft article(s)
                  </button>
                </div>
              ) : null}

              {selected.created_article_ids &&
              selected.created_article_ids.length > 0 ? (
                <p className="admin-caption">
                  Created article ids:{" "}
                  {selected.created_article_ids.join(", ")}
                </p>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
