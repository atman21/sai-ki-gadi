"use client";

import { useAdminAccess } from "@/components/admin/admin-access-provider";
import {
  AI_KNOWLEDGE_LOCALES,
  AI_KNOWLEDGE_STATUSES,
  localeLabel,
  statusLabel,
  type AiKnowledgeLocale,
} from "@/lib/ai-knowledge-admin";
import { useCallback, useEffect, useMemo, useState } from "react";

type CategoryRow = {
  id: string;
  key: string;
  label: string;
  is_active: boolean;
  sort_order: number;
};

type ArticleListItem = {
  id: string;
  category_id: string;
  category_key: string | null;
  category_label: string | null;
  status: string;
  sort_order: number;
  keywords: string[];
  version: number;
  locales: string[];
  title_preview: string;
  body_preview: string;
  published_at: string | null;
  updated_at: string | null;
  gemini_eligible?: boolean;
  rejection_reason?: string | null;
};

type Translation = {
  locale: AiKnowledgeLocale | string;
  title: string;
  body: string;
};

type EditorState = {
  id: string | null;
  category_id: string;
  sort_order: string;
  keywords: string;
  translations: Record<AiKnowledgeLocale, { title: string; body: string }>;
};

type VersionRow = {
  id: string;
  version: number;
  status: string;
  change_reason: string;
  created_at: string;
  locales: string[];
  translations: Array<{ locale?: string; title?: string; body?: string }>;
};

function emptyTranslations(): EditorState["translations"] {
  return {
    en: { title: "", body: "" },
    hi: { title: "", body: "" },
    gu: { title: "", body: "" },
  };
}

function emptyEditor(categoryId = ""): EditorState {
  return {
    id: null,
    category_id: categoryId,
    sort_order: "0",
    keywords: "",
    translations: emptyTranslations(),
  };
}

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

export function AiKnowledgeAdminPanel() {
  const { can } = useAdminAccess();
  const canManage = can("help_ai.manage");

  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [items, setItems] = useState<ArticleListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [localeFilter, setLocaleFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");

  const [mode, setMode] = useState<"list" | "edit" | "preview" | "versions">(
    "list",
  );
  const [editor, setEditor] = useState<EditorState>(emptyEditor());
  const [articleStatus, setArticleStatus] = useState<string>("draft");
  const [previewLocale, setPreviewLocale] = useState<AiKnowledgeLocale>("en");
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [versionArticleId, setVersionArticleId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const pageSize = 25;

  const loadCategories = useCallback(async () => {
    const res = await fetch("/api/admin/ai-management/knowledge/categories", {
      credentials: "include",
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(
        json.error ||
          "Failed to load categories (migration may not be applied yet).",
      );
    }
    setCategories(Array.isArray(json.items) ? json.items : []);
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
      if (localeFilter) params.set("locale", localeFilter);
      if (categoryFilter) params.set("category_id", categoryFilter);

      const res = await fetch(
        `/api/admin/ai-management/knowledge/articles?${params}`,
        { credentials: "include" },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error || "Failed to load articles.");
      }
      setItems(Array.isArray(json.items) ? json.items : []);
      setTotal(Number(json.total ?? 0));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load articles.");
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page, q, statusFilter, localeFilter, categoryFilter]);

  useEffect(() => {
    void loadCategories().catch((e) => {
      setError(e instanceof Error ? e.message : "Failed to load categories.");
    });
  }, [loadCategories]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const openCreate = () => {
    const firstActive = categories.find((c) => c.is_active)?.id ?? "";
    setEditor(emptyEditor(firstActive));
    setArticleStatus("draft");
    setPreviewLocale("en");
    setMode("edit");
    setMessage(null);
    setError(null);
  };

  const openEdit = async (id: string) => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(
        `/api/admin/ai-management/knowledge/articles/${id}`,
        { credentials: "include" },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to load article.");
      const item = json.item as ArticleListItem & { translations?: Translation[] };
      const translations = emptyTranslations();
      for (const row of item.translations ?? []) {
        if (row.locale === "en" || row.locale === "hi" || row.locale === "gu") {
          translations[row.locale] = {
            title: row.title ?? "",
            body: row.body ?? "",
          };
        }
      }
      setEditor({
        id: item.id,
        category_id: item.category_id,
        sort_order: String(item.sort_order ?? 0),
        keywords: (item.keywords ?? []).join(", "),
        translations,
      });
      setArticleStatus(item.status);
      setPreviewLocale("en");
      setMode("edit");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load article.");
    } finally {
      setSaving(false);
    }
  };

  const buildTranslationPayload = () => {
    const translations: {
      locale: AiKnowledgeLocale;
      title: string;
      body: string;
    }[] = [];
    for (const locale of AI_KNOWLEDGE_LOCALES) {
      const title = editor.translations[locale].title.trim();
      const body = editor.translations[locale].body.trim();
      if (!title && !body) continue;
      translations.push({ locale, title, body });
    }
    return translations;
  };

  const saveArticle = async () => {
    if (!canManage) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const payload = {
        category_id: editor.category_id,
        sort_order: Number(editor.sort_order || 0),
        keywords: editor.keywords,
        translations: buildTranslationPayload(),
      };
      const isNew = !editor.id;
      const res = await fetch(
        isNew
          ? "/api/admin/ai-management/knowledge/articles"
          : `/api/admin/ai-management/knowledge/articles/${editor.id}`,
        {
          method: isNew ? "POST" : "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Save failed.");
      setMessage(isNew ? "Draft created." : "Draft saved (not published).");
      setMode("list");
      await loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const runWorkflow = async (
    id: string,
    action: string,
    reason?: string,
  ) => {
    if (!canManage) return;
    setBusyId(id);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(
        `/api/admin/ai-management/knowledge/articles/${id}/workflow`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, reason }),
        },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Workflow failed.");
      setMessage(
        `Article ${action.replace("_", " ")} succeeded.${
          json.gemini_eligible
            ? " Marked Gemini-eligible (retrieval not wired yet)."
            : ""
        }`,
      );
      setRejectReason("");
      if (mode !== "list") setMode("list");
      await loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Workflow failed.");
    } finally {
      setBusyId(null);
    }
  };

  const openVersions = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/ai-management/knowledge/articles/${id}/versions`,
        { credentials: "include" },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to load versions.");
      setVersions(Array.isArray(json.versions) ? json.versions : []);
      setVersionArticleId(id);
      setMode("versions");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load versions.");
    } finally {
      setBusyId(null);
    }
  };

  const editable =
    !editor.id ||
    articleStatus === "draft" ||
    articleStatus === "rejected";

  const previewTranslation = useMemo(() => {
    return editor.translations[previewLocale];
  }, [editor.translations, previewLocale]);

  if (mode === "edit" || mode === "preview") {
    return (
      <div className="space-y-4">
        <div className="admin-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="admin-eyebrow">SKG AI Management</p>
              <h2 className="admin-section-title mt-1">
                {editor.id ? "Edit knowledge article" : "New knowledge article"}
              </h2>
              <p className="admin-caption mt-1">
                Status: {statusLabel(articleStatus)} · Draft saves never publish.
                Gemini retrieval is not wired.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="admin-btn admin-btn-secondary"
                onClick={() => setMode("list")}
              >
                Back
              </button>
              <button
                type="button"
                className="admin-btn admin-btn-secondary"
                onClick={() =>
                  setMode(mode === "preview" ? "edit" : "preview")
                }
              >
                {mode === "preview" ? "Edit" : "Preview"}
              </button>
              {canManage && editable ? (
                <button
                  type="button"
                  className="admin-btn admin-btn-primary"
                  disabled={saving}
                  onClick={() => void saveArticle()}
                >
                  {saving ? "Saving…" : "Save Draft"}
                </button>
              ) : null}
            </div>
          </div>
          {error ? (
            <p className="mt-3 text-sm text-[var(--admin-danger)]">{error}</p>
          ) : null}
          {message ? (
            <p className="mt-3 text-sm text-[var(--admin-text-secondary)]">
              {message}
            </p>
          ) : null}
        </div>

        {mode === "preview" ? (
          <div className="admin-card space-y-3 p-5">
            <div className="flex flex-wrap gap-2">
              {AI_KNOWLEDGE_LOCALES.map((locale) => (
                <button
                  key={locale}
                  type="button"
                  className={`admin-btn ${
                    previewLocale === locale
                      ? "admin-btn-primary"
                      : "admin-btn-secondary"
                  }`}
                  onClick={() => setPreviewLocale(locale)}
                >
                  {localeLabel(locale)}
                </button>
              ))}
            </div>
            <h3 className="text-lg font-semibold">
              {previewTranslation.title || "(empty title)"}
            </h3>
            <pre className="whitespace-pre-wrap text-sm text-[var(--admin-text-secondary)]">
              {previewTranslation.body || "(empty body)"}
            </pre>
          </div>
        ) : (
          <div className="admin-card space-y-4 p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
                  Category
                </span>
                <select
                  className="admin-input mt-1 w-full"
                  disabled={!canManage || !editable}
                  value={editor.category_id}
                  onChange={(e) =>
                    setEditor((prev) => ({
                      ...prev,
                      category_id: e.target.value,
                    }))
                  }
                >
                  <option value="">Select category</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
                  Sort order
                </span>
                <input
                  className="admin-input mt-1 w-full"
                  disabled={!canManage || !editable}
                  value={editor.sort_order}
                  onChange={(e) =>
                    setEditor((prev) => ({
                      ...prev,
                      sort_order: e.target.value,
                    }))
                  }
                />
              </label>
            </div>
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wide text-[var(--admin-text-faint)]">
                Keywords (comma-separated)
              </span>
              <input
                className="admin-input mt-1 w-full"
                disabled={!canManage || !editable}
                value={editor.keywords}
                onChange={(e) =>
                  setEditor((prev) => ({ ...prev, keywords: e.target.value }))
                }
              />
            </label>

            {AI_KNOWLEDGE_LOCALES.map((locale) => (
              <div
                key={locale}
                className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] p-3"
              >
                <h4 className="text-sm font-semibold">
                  {localeLabel(locale)} ({locale})
                </h4>
                <label className="mt-2 block">
                  <span className="admin-caption">Title</span>
                  <input
                    className="admin-input mt-1 w-full"
                    disabled={!canManage || !editable}
                    value={editor.translations[locale].title}
                    onChange={(e) =>
                      setEditor((prev) => ({
                        ...prev,
                        translations: {
                          ...prev.translations,
                          [locale]: {
                            ...prev.translations[locale],
                            title: e.target.value,
                          },
                        },
                      }))
                    }
                  />
                </label>
                <label className="mt-2 block">
                  <span className="admin-caption">Body</span>
                  <textarea
                    className="admin-input mt-1 min-h-[120px] w-full"
                    disabled={!canManage || !editable}
                    value={editor.translations[locale].body}
                    onChange={(e) =>
                      setEditor((prev) => ({
                        ...prev,
                        translations: {
                          ...prev.translations,
                          [locale]: {
                            ...prev.translations[locale],
                            body: e.target.value,
                          },
                        },
                      }))
                    }
                  />
                </label>
              </div>
            ))}

            {editor.id && canManage ? (
              <div className="flex flex-wrap gap-2 border-t border-[var(--admin-border)] pt-4">
                {(articleStatus === "draft" ||
                  articleStatus === "rejected") && (
                  <button
                    type="button"
                    className="admin-btn"
                    disabled={busyId === editor.id}
                    onClick={() => void runWorkflow(editor.id!, "submit_review")}
                  >
                    Submit for review
                  </button>
                )}
                {articleStatus === "pending_review" && (
                  <>
                    <button
                      type="button"
                      className="admin-btn admin-btn-success"
                      disabled={busyId === editor.id}
                      onClick={() => void runWorkflow(editor.id!, "approve")}
                    >
                      Approve
                    </button>
                    <input
                      className="admin-input max-w-xs"
                      placeholder="Rejection reason"
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                    />
                    <button
                      type="button"
                      className="admin-btn admin-btn-danger"
                      disabled={busyId === editor.id}
                      onClick={() =>
                        void runWorkflow(editor.id!, "reject", rejectReason)
                      }
                    >
                      Reject
                    </button>
                  </>
                )}
                {articleStatus === "approved" && (
                  <button
                    type="button"
                    className="admin-btn admin-btn-primary"
                    disabled={busyId === editor.id}
                    onClick={() => void runWorkflow(editor.id!, "publish")}
                  >
                    Publish
                  </button>
                )}
                {articleStatus === "published" && (
                  <button
                    type="button"
                    className="admin-btn admin-btn-secondary"
                    disabled={busyId === editor.id}
                    onClick={() => void runWorkflow(editor.id!, "unpublish")}
                  >
                    Unpublish
                  </button>
                )}
                {articleStatus !== "archived" && (
                  <button
                    type="button"
                    className="admin-btn admin-btn-secondary"
                    disabled={busyId === editor.id}
                    onClick={() => void runWorkflow(editor.id!, "archive")}
                  >
                    Archive
                  </button>
                )}
              </div>
            ) : null}
          </div>
        )}
      </div>
    );
  }

  if (mode === "versions") {
    return (
      <div className="admin-card space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="admin-eyebrow">SKG AI Management</p>
            <h2 className="admin-section-title mt-1">Version history</h2>
            <p className="admin-caption mt-1">Article {versionArticleId}</p>
          </div>
          <button
            type="button"
            className="admin-btn admin-btn-secondary"
            onClick={() => setMode("list")}
          >
            Back to list
          </button>
        </div>
        {versions.length === 0 ? (
          <p className="admin-caption">No versions recorded.</p>
        ) : (
          <ul className="divide-y divide-[var(--admin-border)]">
            {versions.map((row) => (
              <li key={row.id} className="py-3">
                <p className="text-sm font-medium">
                  v{row.version} · {statusLabel(row.status)} ·{" "}
                  {row.change_reason}
                </p>
                <p className="admin-caption">
                  {formatWhen(row.created_at)} · locales:{" "}
                  {(row.locales ?? []).join(", ") || "—"}
                </p>
                {row.translations?.[0]?.title ? (
                  <p className="mt-1 text-sm text-[var(--admin-text-secondary)]">
                    {(row.translations.find((t) => t.locale === "en") ??
                      row.translations[0]
                    ).title}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="admin-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="admin-eyebrow">SKG AI Management</p>
            <h2 className="admin-section-title mt-1">Knowledge Base</h2>
            <p className="admin-caption mt-2 max-w-3xl">
              Curated SKG App knowledge for future Gemini retrieval. Distinct
              from Help FAQ. Only <strong>Published</strong> articles will be
              eligible later — Live does not load Knowledge Base yet.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="admin-btn admin-btn-secondary"
              onClick={() => void loadList()}
            >
              Refresh
            </button>
            {canManage ? (
              <button
                type="button"
                className="admin-btn admin-btn-primary"
                onClick={openCreate}
              >
                New article
              </button>
            ) : (
              <span className="admin-badge admin-badge-neutral">View only</span>
            )}
          </div>
        </div>

        <p className="mt-4 rounded-[var(--admin-radius-sm)] border border-dashed border-[var(--admin-border)] bg-[var(--admin-surface-muted)] p-3 text-sm text-[var(--admin-text-secondary)]">
          Gemini retrieval status: <strong>not wired</strong>. Unpublished /
          draft / rejected content is Admin-only (service_role). Requires
          migration <code>20261116190000_skg_ai_knowledge_phase3b.sql</code>{" "}
          applied on Staging before live data works.
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

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <input
            className="admin-input"
            placeholder="Search title, body, keywords…"
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
            {AI_KNOWLEDGE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </select>
          <select
            className="admin-input"
            value={categoryFilter}
            onChange={(e) => {
              setPage(1);
              setCategoryFilter(e.target.value);
            }}
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <select
            className="admin-input"
            value={localeFilter}
            onChange={(e) => {
              setPage(1);
              setLocaleFilter(e.target.value);
            }}
          >
            <option value="">All languages</option>
            {AI_KNOWLEDGE_LOCALES.map((l) => (
              <option key={l} value={l}>
                {localeLabel(l)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="admin-card overflow-x-auto p-0">
        {loading ? (
          <p className="p-5 admin-caption">Loading articles…</p>
        ) : items.length === 0 ? (
          <p className="p-5 admin-caption">
            No knowledge articles found. Create a draft to get started.
          </p>
        ) : (
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-[var(--admin-border)] bg-[var(--admin-surface-muted)] text-xs uppercase tracking-wide text-[var(--admin-text-faint)]">
              <tr>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Languages</th>
                <th className="px-4 py-3">Updated</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.id}
                  className="border-b border-[var(--admin-border)] align-top"
                >
                  <td className="px-4 py-3">
                    <p className="font-medium text-[var(--admin-text)]">
                      {item.title_preview || "(untitled)"}
                    </p>
                    <p className="admin-caption">v{item.version}</p>
                  </td>
                  <td className="px-4 py-3">
                    {item.category_label || item.category_key || "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span className="admin-badge admin-badge-neutral">
                      {statusLabel(item.status)}
                    </span>
                    {item.status === "published" ? (
                      <span className="ml-1 admin-caption">Gemini-eligible*</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    {(item.locales ?? []).join(", ") || "—"}
                  </td>
                  <td className="px-4 py-3">{formatWhen(item.updated_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="admin-btn admin-btn-secondary"
                        onClick={() => void openEdit(item.id)}
                      >
                        Open
                      </button>
                      <button
                        type="button"
                        className="admin-btn admin-btn-secondary"
                        disabled={busyId === item.id}
                        onClick={() => void openVersions(item.id)}
                      >
                        Versions
                      </button>
                      {canManage && item.status === "approved" ? (
                        <button
                          type="button"
                          className="admin-btn admin-btn-primary"
                          disabled={busyId === item.id}
                          onClick={() => void runWorkflow(item.id, "publish")}
                        >
                          Publish
                        </button>
                      ) : null}
                      {canManage && item.status === "published" ? (
                        <button
                          type="button"
                          className="admin-btn admin-btn-secondary"
                          disabled={busyId === item.id}
                          onClick={() => void runWorkflow(item.id, "unpublish")}
                        >
                          Unpublish
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="admin-caption">
          Page {page} of {totalPages} · {total} total
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

      <div className="admin-card p-5">
        <h3 className="text-base font-semibold">Categories</h3>
        <p className="admin-caption mt-1">
          Seeded keys only — no invented policies or prices. Toggle active /
          rename via manage.
        </p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((c) => (
            <li
              key={c.id}
              className="rounded-[var(--admin-radius-sm)] border border-[var(--admin-border)] px-3 py-2 text-sm"
            >
              <span className="font-medium">{c.label}</span>
              <span className="admin-caption ml-2">
                {c.key}
                {c.is_active ? "" : " · inactive"}
              </span>
              {canManage ? (
                <button
                  type="button"
                  className="admin-btn admin-btn-ghost ml-2 text-xs"
                  onClick={() => {
                    void (async () => {
                      const res = await fetch(
                        "/api/admin/ai-management/knowledge/categories",
                        {
                          method: "PATCH",
                          credentials: "include",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            id: c.id,
                            is_active: !c.is_active,
                          }),
                        },
                      );
                      const json = await res.json().catch(() => ({}));
                      if (!res.ok) {
                        setError(json.error || "Category update failed.");
                        return;
                      }
                      await loadCategories();
                    })();
                  }}
                >
                  {c.is_active ? "Deactivate" : "Activate"}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
