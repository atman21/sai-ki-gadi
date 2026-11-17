"use client";

import { useAdminAccess } from "@/components/admin/admin-access-provider";
import {
  HELP_FAQ_LOCALES,
  categoryLabel,
  localeLabel,
  type HelpFaqLocale,
  type HelpFaqStatus,
} from "@/lib/help-faq-admin";
import { useCallback, useEffect, useMemo, useState } from "react";

type CategoryRow = {
  id: string;
  key: string;
  label: string;
  is_active: boolean;
};

type FaqListItem = {
  id: string;
  category_id: string;
  category_key: string | null;
  category_label: string | null;
  status: HelpFaqStatus | string;
  sort_order: number;
  keywords: string[];
  is_popular: boolean;
  published_at: string | null;
  updated_at: string | null;
  locales: string[];
  question_preview: string;
  answer_preview: string;
};

type FaqTranslation = {
  id?: string;
  locale: HelpFaqLocale | string;
  question: string;
  answer: string;
};

type FaqDetail = {
  id: string;
  category_id: string;
  status: string;
  sort_order: number;
  keywords: string[];
  is_popular: boolean;
  published_at: string | null;
  updated_at: string | null;
  translations: FaqTranslation[];
  locales: string[];
};

type EditorState = {
  id: string | null;
  category_id: string;
  sort_order: string;
  is_popular: boolean;
  keywords: string;
  translations: Record<HelpFaqLocale, { question: string; answer: string }>;
};

function emptyTranslations(): EditorState["translations"] {
  return {
    en: { question: "", answer: "" },
    hi: { question: "", answer: "" },
    gu: { question: "", answer: "" },
  };
}

function emptyEditor(categoryId = ""): EditorState {
  return {
    id: null,
    category_id: categoryId,
    sort_order: "0",
    is_popular: false,
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

export function HelpFaqAdminPanel() {
  const adminAccess = useAdminAccess();
  const canManage = Boolean(adminAccess.can("help.manage"));

  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [items, setItems] = useState<FaqListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [localeFilter, setLocaleFilter] = useState<string>("");
  const [categoryFilter, setCategoryFilter] = useState<string>("");

  const [mode, setMode] = useState<"list" | "edit" | "preview">("list");
  const [editor, setEditor] = useState<EditorState>(emptyEditor());
  const [previewLocale, setPreviewLocale] = useState<HelpFaqLocale>("en");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const pageSize = 25;

  const loadCategories = useCallback(async () => {
    const res = await fetch("/api/admin/help-faq-categories", {
      credentials: "include",
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(json.error || "Failed to load categories");
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

      const res = await fetch(`/api/admin/help-faqs?${params.toString()}`, {
        credentials: "include",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error || "Failed to load FAQs");
      }
      setItems(Array.isArray(json.items) ? json.items : []);
      setTotal(Number(json.total ?? 0));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load FAQs");
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page, q, statusFilter, localeFilter, categoryFilter]);

  useEffect(() => {
    void loadCategories().catch((e) => {
      setError(e instanceof Error ? e.message : "Failed to load categories");
    });
  }, [loadCategories]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const openCreate = () => {
    const firstActive = categories.find((c) => c.is_active)?.id ?? "";
    setEditor(emptyEditor(firstActive));
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
      const res = await fetch(`/api/admin/help-faqs/${id}`, {
        credentials: "include",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to load FAQ");
      const item = json.item as FaqDetail;
      const translations = emptyTranslations();
      for (const row of item.translations ?? []) {
        if (row.locale === "en" || row.locale === "hi" || row.locale === "gu") {
          translations[row.locale] = {
            question: row.question ?? "",
            answer: row.answer ?? "",
          };
        }
      }
      setEditor({
        id: item.id,
        category_id: item.category_id,
        sort_order: String(item.sort_order ?? 0),
        is_popular: Boolean(item.is_popular),
        keywords: (item.keywords ?? []).join(", "),
        translations,
      });
      setPreviewLocale("en");
      setMode("edit");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load FAQ");
    } finally {
      setSaving(false);
    }
  };

  const buildTranslationPayload = () => {
    const translations: {
      locale: HelpFaqLocale;
      question: string;
      answer: string;
    }[] = [];
    for (const locale of HELP_FAQ_LOCALES) {
      const question = editor.translations[locale].question.trim();
      const answer = editor.translations[locale].answer.trim();
      if (!question && !answer) continue;
      translations.push({ locale, question, answer });
    }
    return translations;
  };

  const saveEditor = async () => {
    if (!canManage) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const translations = buildTranslationPayload();
      if (!editor.category_id) {
        throw new Error("Category is required.");
      }
      if (translations.length === 0) {
        throw new Error("Add at least one language with question and answer.");
      }
      for (const row of translations) {
        if (!row.question || !row.answer) {
          throw new Error(
            `Question and answer are both required for ${localeLabel(row.locale)}.`,
          );
        }
      }

      const payload = {
        category_id: editor.category_id,
        sort_order: Number(editor.sort_order),
        is_popular: editor.is_popular,
        keywords: editor.keywords,
        translations,
      };

      const res = await fetch(
        editor.id ? `/api/admin/help-faqs/${editor.id}` : "/api/admin/help-faqs",
        {
          method: editor.id ? "PUT" : "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Save failed");

      setMessage(editor.id ? "FAQ updated." : "FAQ created as draft.");
      setMode("list");
      await loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (id: string, action: "publish" | "unpublish") => {
    if (!canManage) return;
    setBusyId(id);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/help-faqs/${id}/${action}`, {
        method: "POST",
        credentials: "include",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Failed to ${action}`);
      setMessage(action === "publish" ? "FAQ published." : "FAQ unpublished.");
      await loadList();
      if (editor.id === id) {
        // refresh editor status indirectly by reloading list only
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : `Failed to ${action}`);
    } finally {
      setBusyId(null);
    }
  };

  const previewContent = useMemo(() => {
    const row = editor.translations[previewLocale];
    const question = row.question.trim();
    const answer = row.answer.trim();
    if (question && answer) {
      return {
        locale: previewLocale,
        question,
        answer,
        usedFallback: false,
      };
    }
    const en = editor.translations.en;
    if (previewLocale !== "en" && en.question.trim() && en.answer.trim()) {
      return {
        locale: "en" as const,
        question: en.question.trim(),
        answer: en.answer.trim(),
        usedFallback: true,
      };
    }
    return null;
  }, [editor.translations, previewLocale]);

  if (mode === "edit" || mode === "preview") {
    return (
      <div className="space-y-4">
        <div className="admin-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="admin-eyebrow">FAQ &amp; Help Center</p>
              <h2 className="admin-section-title mt-1">
                {editor.id ? "Edit FAQ" : "Create FAQ"}
              </h2>
              <p className="admin-caption mt-1">
                Locales: English, Hindi, Gujarati. Omitted languages are left
                unchanged on edit. Publish requires English.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="h-10 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                onClick={() => setMode(mode === "preview" ? "edit" : "preview")}
              >
                {mode === "preview" ? "Back to editor" : "Mobile preview"}
              </button>
              <button
                type="button"
                className="h-10 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                onClick={() => {
                  setMode("list");
                  setError(null);
                }}
              >
                Cancel
              </button>
            </div>
          </div>

          {error ? (
            <p className="mt-3 text-sm font-medium text-red-700">{error}</p>
          ) : null}
          {message ? (
            <p className="mt-3 text-sm font-medium text-emerald-700">{message}</p>
          ) : null}

          {mode === "preview" ? (
            <div className="mt-5 space-y-4">
              <div className="flex flex-wrap gap-2">
                {HELP_FAQ_LOCALES.map((locale) => (
                  <button
                    key={locale}
                    type="button"
                    onClick={() => setPreviewLocale(locale)}
                    className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
                      previewLocale === locale
                        ? "bg-slate-900 text-white"
                        : "border border-slate-300 bg-white text-slate-700"
                    }`}
                  >
                    {localeLabel(locale)}
                  </button>
                ))}
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                {previewContent ? (
                  <>
                    <p className="text-lg font-bold leading-snug text-slate-900">
                      {previewContent.question}
                    </p>
                    {previewContent.usedFallback ? (
                      <p className="mt-2 text-xs font-medium text-slate-500">
                        Showing English fallback (Mobile convention)
                      </p>
                    ) : null}
                    <p className="mt-3 whitespace-pre-wrap text-[15px] leading-6 text-slate-800">
                      {previewContent.answer}
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-slate-600">
                    No content available for this language (and no English
                    fallback).
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="mt-5 grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <label className="block text-sm">
                  <span className="font-semibold text-slate-700">Category</span>
                  <select
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                    value={editor.category_id}
                    disabled={!canManage}
                    onChange={(e) =>
                      setEditor((prev) => ({
                        ...prev,
                        category_id: e.target.value,
                      }))
                    }
                  >
                    <option value="">Select category</option>
                    {categories
                      .filter((c) => c.is_active)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label || categoryLabel(c.key)}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="font-semibold text-slate-700">Sort order</span>
                  <input
                    type="number"
                    min={0}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                    value={editor.sort_order}
                    disabled={!canManage}
                    onChange={(e) =>
                      setEditor((prev) => ({
                        ...prev,
                        sort_order: e.target.value,
                      }))
                    }
                  />
                </label>
                <label className="block text-sm">
                  <span className="font-semibold text-slate-700">
                    Keywords (comma-separated)
                  </span>
                  <input
                    type="text"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                    value={editor.keywords}
                    disabled={!canManage}
                    onChange={(e) =>
                      setEditor((prev) => ({
                        ...prev,
                        keywords: e.target.value,
                      }))
                    }
                  />
                </label>
                <label className="mt-6 flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={editor.is_popular}
                    disabled={!canManage}
                    onChange={(e) =>
                      setEditor((prev) => ({
                        ...prev,
                        is_popular: e.target.checked,
                      }))
                    }
                  />
                  Popular FAQ
                </label>
              </div>

              {HELP_FAQ_LOCALES.map((locale) => (
                <div
                  key={locale}
                  className="rounded-xl border border-slate-200 bg-slate-50/60 p-4"
                >
                  <p className="text-sm font-bold text-slate-900">
                    {localeLabel(locale)}{" "}
                    <span className="font-mono text-xs font-normal text-slate-500">
                      ({locale})
                    </span>
                    {locale === "en" ? (
                      <span className="ml-2 text-xs font-semibold text-amber-700">
                        Required to publish
                      </span>
                    ) : null}
                  </p>
                  <label className="mt-3 block text-sm">
                    <span className="font-semibold text-slate-700">Question</span>
                    <input
                      type="text"
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                      value={editor.translations[locale].question}
                      disabled={!canManage}
                      onChange={(e) =>
                        setEditor((prev) => ({
                          ...prev,
                          translations: {
                            ...prev.translations,
                            [locale]: {
                              ...prev.translations[locale],
                              question: e.target.value,
                            },
                          },
                        }))
                      }
                    />
                  </label>
                  <label className="mt-3 block text-sm">
                    <span className="font-semibold text-slate-700">Answer</span>
                    <textarea
                      rows={5}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                      value={editor.translations[locale].answer}
                      disabled={!canManage}
                      onChange={(e) =>
                        setEditor((prev) => ({
                          ...prev,
                          translations: {
                            ...prev.translations,
                            [locale]: {
                              ...prev.translations[locale],
                              answer: e.target.value,
                            },
                          },
                        }))
                      }
                    />
                  </label>
                </div>
              ))}

              {canManage ? (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void saveEditor()}
                    className="h-10 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                  >
                    {saving ? "Saving…" : editor.id ? "Save changes" : "Create draft"}
                  </button>
                  {editor.id ? (
                    <>
                      <button
                        type="button"
                        disabled={saving || busyId === editor.id}
                        onClick={() => void setStatus(editor.id!, "publish")}
                        className="h-10 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                      >
                        Publish
                      </button>
                      <button
                        type="button"
                        disabled={saving || busyId === editor.id}
                        onClick={() => void setStatus(editor.id!, "unpublish")}
                        className="h-10 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                      >
                        Unpublish
                      </button>
                    </>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm text-slate-600">
                  View-only: your role cannot create or edit FAQs.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="admin-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="admin-eyebrow">SKG AI Management</p>
            <h2 className="admin-section-title mt-1">FAQ &amp; Help Center</h2>
            <p className="admin-caption mt-1 max-w-2xl">
              Manage Help Center FAQs (en / hi / gu) using the Mobile T29 tables.
              Draft FAQs are hidden from the app until published.
            </p>
          </div>
          {canManage ? (
            <button
              type="button"
              onClick={openCreate}
              className="h-10 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800"
            >
              Create FAQ
            </button>
          ) : (
            <span className="admin-badge admin-badge-neutral">View only</span>
          )}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <input
            type="search"
            placeholder="Search question or answer"
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={q}
            onChange={(e) => {
              setPage(1);
              setQ(e.target.value);
            }}
          />
          <select
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={statusFilter}
            onChange={(e) => {
              setPage(1);
              setStatusFilter(e.target.value);
            }}
          >
            <option value="">All statuses</option>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
          </select>
          <select
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={localeFilter}
            onChange={(e) => {
              setPage(1);
              setLocaleFilter(e.target.value);
            }}
          >
            <option value="">All languages</option>
            {HELP_FAQ_LOCALES.map((locale) => (
              <option key={locale} value={locale}>
                {localeLabel(locale)}
              </option>
            ))}
          </select>
          <select
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={categoryFilter}
            onChange={(e) => {
              setPage(1);
              setCategoryFilter(e.target.value);
            }}
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label || categoryLabel(c.key)}
              </option>
            ))}
          </select>
        </div>

        {error ? (
          <p className="mt-3 text-sm font-medium text-red-700">{error}</p>
        ) : null}
        {message ? (
          <p className="mt-3 text-sm font-medium text-emerald-700">{message}</p>
        ) : null}
      </div>

      <div className="admin-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Question</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Languages</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Updated</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="px-4 py-6 text-slate-600" colSpan={6}>
                    Loading FAQs…
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-slate-600" colSpan={6}>
                    No FAQs match the current filters.
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className="border-t border-slate-100">
                    <td className="max-w-md px-4 py-3">
                      <p className="font-semibold text-slate-900">
                        {item.question_preview || "(no preview)"}
                      </p>
                      {item.is_popular ? (
                        <span className="mt-1 inline-block text-xs font-semibold text-amber-700">
                          Popular
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {item.category_label ?? item.category_key ?? "—"}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">
                      {item.locales.join(", ") || "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          item.status === "published"
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-slate-100 text-slate-700"
                        }`}
                      >
                        {item.status}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                      {formatWhen(item.updated_at)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="text-sm font-semibold text-slate-900 underline"
                          onClick={() => void openEdit(item.id)}
                        >
                          {canManage ? "Edit" : "View"}
                        </button>
                        {canManage && item.status !== "published" ? (
                          <button
                            type="button"
                            disabled={busyId === item.id}
                            className="text-sm font-semibold text-emerald-700 underline disabled:opacity-50"
                            onClick={() => void setStatus(item.id, "publish")}
                          >
                            Publish
                          </button>
                        ) : null}
                        {canManage && item.status === "published" ? (
                          <button
                            type="button"
                            disabled={busyId === item.id}
                            className="text-sm font-semibold text-amber-700 underline disabled:opacity-50"
                            onClick={() => void setStatus(item.id, "unpublish")}
                          >
                            Unpublish
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm text-slate-600">
          <span>
            Page {page} of {totalPages} · {total} total
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              className="rounded-lg border border-slate-300 px-3 py-1.5 font-semibold disabled:opacity-40"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              className="rounded-lg border border-slate-300 px-3 py-1.5 font-semibold disabled:opacity-40"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
