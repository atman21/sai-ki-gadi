"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useAdminAccessOptional } from "@/components/admin/admin-access-provider";

type CategoryRow = {
  id: string;
  key: string;
  sort_order: number;
  is_active: boolean;
  faq_count?: number;
  created_at?: string;
  updated_at?: string;
};

type TranslationRow = {
  id?: string;
  locale: string;
  question: string;
  answer: string;
  updated_at?: string;
};

type FaqRow = {
  id: string;
  category_id: string;
  status: "draft" | "published";
  sort_order: number;
  keywords: string[];
  is_popular: boolean;
  published_at: string | null;
  question_en?: string | null;
  translation_locales?: string[];
  missing_locales?: string[];
  help_faq_categories?: { id: string; key: string; is_active: boolean } | null;
  help_faq_translations?: TranslationRow[];
};

type SubTab = "faqs" | "categories";
type FaqMode = "list" | "create" | "edit";

const LOCALES = [
  { code: "en", label: "English" },
  { code: "hi", label: "Hindi" },
  { code: "gu", label: "Gujarati" },
] as const;

function formatDt(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-IN");
  } catch {
    return iso;
  }
}

export function HelpCenterPanel() {
  const adminAccess = useAdminAccessOptional();
  const canManage = adminAccess?.can("help.manage") ?? false;

  const [subTab, setSubTab] = useState<SubTab>("faqs");
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [faqs, setFaqs] = useState<FaqRow[]>([]);
  const [faqTotal, setFaqTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Category form
  const [catMode, setCatMode] = useState<"list" | "create" | "edit">("list");
  const [catActive, setCatActive] = useState<CategoryRow | null>(null);
  const [catKey, setCatKey] = useState("");
  const [catSort, setCatSort] = useState("0");
  const [catActiveFlag, setCatActiveFlag] = useState(true);
  const [saving, setSaving] = useState(false);

  // FAQ form
  const [faqMode, setFaqMode] = useState<FaqMode>("list");
  const [faqActive, setFaqActive] = useState<FaqRow | null>(null);
  const [faqCategoryId, setFaqCategoryId] = useState("");
  const [faqSort, setFaqSort] = useState("0");
  const [faqKeywords, setFaqKeywords] = useState("");
  const [faqPopular, setFaqPopular] = useState(false);
  const [faqQuestionEn, setFaqQuestionEn] = useState("");
  const [faqAnswerEn, setFaqAnswerEn] = useState("");
  const [activeLocale, setActiveLocale] = useState<"en" | "hi" | "gu">("en");
  const [localeQuestion, setLocaleQuestion] = useState("");
  const [localeAnswer, setLocaleAnswer] = useState("");
  const [translations, setTranslations] = useState<TranslationRow[]>([]);
  const [previewLocale, setPreviewLocale] = useState<"en" | "hi" | "gu" | null>(
    null,
  );

  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(faqTotal / pageSize));

  const loadCategories = useCallback(async () => {
    const res = await fetch("/api/admin/help/categories?pageSize=100");
    const json = await res.json();
    if (!res.ok || !json.ok) {
      throw new Error(json.error ?? "Failed to load categories");
    }
    setCategories(json.rows ?? []);
  }, []);

  const loadFaqs = useCallback(async () => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });
    if (q) params.set("q", q);
    if (statusFilter) params.set("status", statusFilter);
    if (categoryFilter) params.set("categoryId", categoryFilter);
    const res = await fetch(`/api/admin/help/faqs?${params}`);
    const json = await res.json();
    if (!res.ok || !json.ok) {
      throw new Error(json.error ?? "Failed to load FAQs");
    }
    setFaqs(json.rows ?? []);
    setFaqTotal(json.total ?? 0);
  }, [page, q, statusFilter, categoryFilter]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([loadCategories(), loadFaqs()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [loadCategories, loadFaqs]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const categoryOptions = useMemo(
    () =>
      [...categories].sort((a, b) => a.sort_order - b.sort_order || a.key.localeCompare(b.key)),
    [categories],
  );

  function openCreateCategory() {
    setCatMode("create");
    setCatActive(null);
    setCatKey("");
    setCatSort(String((categories.at(-1)?.sort_order ?? 0) + 10));
    setCatActiveFlag(true);
    setError(null);
    setSuccess(null);
  }

  function openEditCategory(row: CategoryRow) {
    setCatMode("edit");
    setCatActive(row);
    setCatKey(row.key);
    setCatSort(String(row.sort_order));
    setCatActiveFlag(row.is_active);
    setError(null);
    setSuccess(null);
  }

  async function saveCategory() {
    if (!canManage) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const payload = {
        key: catKey,
        sort_order: Number(catSort),
        is_active: catActiveFlag,
      };
      const res = await fetch(
        catMode === "edit" && catActive
          ? `/api/admin/help/categories/${catActive.id}`
          : "/api/admin/help/categories",
        {
          method: catMode === "edit" ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Save failed");
      setSuccess(catMode === "edit" ? "Category updated." : "Category created.");
      setCatMode("list");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function deleteCategory(row: CategoryRow) {
    if (!canManage) return;
    if (
      !confirm(
        `Delete category "${row.key}"? This is blocked if any FAQs still use it.`,
      )
    ) {
      return;
    }
    setError(null);
    try {
      const res = await fetch(`/api/admin/help/categories/${row.id}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Delete failed");
      setSuccess("Category deleted.");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  function openCreateFaq() {
    setFaqMode("create");
    setFaqActive(null);
    setFaqCategoryId(categoryOptions.find((c) => c.is_active)?.id ?? "");
    setFaqSort("0");
    setFaqKeywords("");
    setFaqPopular(false);
    setFaqQuestionEn("");
    setFaqAnswerEn("");
    setTranslations([]);
    setActiveLocale("en");
    setLocaleQuestion("");
    setLocaleAnswer("");
    setPreviewLocale(null);
    setError(null);
    setSuccess(null);
  }

  async function openEditFaq(row: FaqRow) {
    setError(null);
    setSuccess(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/help/faqs/${row.id}`);
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Failed to load FAQ");
      const detail = json.row as FaqRow;
      setFaqActive(detail);
      setFaqCategoryId(detail.category_id);
      setFaqSort(String(detail.sort_order));
      setFaqKeywords((detail.keywords ?? []).join(", "));
      setFaqPopular(Boolean(detail.is_popular));
      const tr = Array.isArray(detail.help_faq_translations)
        ? detail.help_faq_translations
        : [];
      setTranslations(tr);
      const en = tr.find((t) => t.locale === "en");
      setFaqQuestionEn(en?.question ?? "");
      setFaqAnswerEn(en?.answer ?? "");
      setActiveLocale("en");
      setLocaleQuestion(en?.question ?? "");
      setLocaleAnswer(en?.answer ?? "");
      setFaqMode("edit");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load FAQ");
    } finally {
      setLoading(false);
    }
  }

  function selectLocaleTab(code: "en" | "hi" | "gu") {
    setActiveLocale(code);
    const existing = translations.find((t) => t.locale === code);
    if (code === "en") {
      setLocaleQuestion(faqQuestionEn || existing?.question || "");
      setLocaleAnswer(faqAnswerEn || existing?.answer || "");
    } else {
      setLocaleQuestion(existing?.question ?? "");
      setLocaleAnswer(existing?.answer ?? "");
    }
  }

  async function saveFaqMeta() {
    if (!canManage) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      if (faqMode === "create") {
        const res = await fetch("/api/admin/help/faqs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            category_id: faqCategoryId,
            sort_order: Number(faqSort),
            keywords: faqKeywords,
            is_popular: faqPopular,
            question_en: faqQuestionEn || localeQuestion,
            answer_en: faqAnswerEn || localeAnswer,
            status: "draft",
          }),
        });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error ?? "Create failed");
        setSuccess("FAQ created as draft.");
        setFaqMode("list");
        await refresh();
        return;
      }

      if (!faqActive) return;
      const res = await fetch(`/api/admin/help/faqs/${faqActive.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category_id: faqCategoryId,
          sort_order: Number(faqSort),
          keywords: faqKeywords,
          is_popular: faqPopular,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Update failed");
      setSuccess("FAQ details updated.");
      await openEditFaq({ ...faqActive, id: faqActive.id } as FaqRow);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function saveTranslation() {
    if (!canManage || !faqActive) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(
        `/api/admin/help/faqs/${faqActive.id}/translations/${activeLocale}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question: localeQuestion,
            answer: localeAnswer,
          }),
        },
      );
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Translation save failed");
      if (activeLocale === "en") {
        setFaqQuestionEn(localeQuestion);
        setFaqAnswerEn(localeAnswer);
      }
      setSuccess(`${activeLocale.toUpperCase()} translation saved.`);
      await openEditFaq(faqActive);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Translation save failed");
    } finally {
      setSaving(false);
    }
  }

  async function publishFaq(row: FaqRow) {
    if (!canManage) return;
    const missing = row.missing_locales ?? [];
    const msg =
      missing.length > 0
        ? `Publish this FAQ? Missing translations: ${missing.join(", ")}. Mobile will fall back to English where needed.`
        : "Publish this FAQ? It will appear on Mobile if the category is active.";
    if (!confirm(msg)) return;
    setError(null);
    try {
      const res = await fetch(`/api/admin/help/faqs/${row.id}/publish`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Publish failed");
      setSuccess("FAQ published.");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Publish failed");
    }
  }

  async function unpublishFaq(row: FaqRow) {
    if (!canManage) return;
    if (!confirm("Unpublish this FAQ? It will become a draft and disappear from Mobile.")) {
      return;
    }
    setError(null);
    try {
      const res = await fetch(`/api/admin/help/faqs/${row.id}/unpublish`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Unpublish failed");
      setSuccess("FAQ unpublished (draft).");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unpublish failed");
    }
  }

  async function deleteFaq(row: FaqRow) {
    if (!canManage) return;
    if (!confirm("Delete this FAQ and all translations? This cannot be undone.")) {
      return;
    }
    setError(null);
    try {
      const res = await fetch(`/api/admin/help/faqs/${row.id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Delete failed");
      setSuccess("FAQ deleted.");
      setFaqMode("list");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  const previewTranslation = translations.find((t) => t.locale === previewLocale);

  if (faqMode === "create" || faqMode === "edit") {
    return (
      <div className="admin-card p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-slate-900">
            {faqMode === "create" ? "Create FAQ" : "Edit FAQ"}
          </h2>
          <button
            type="button"
            className="admin-btn admin-btn-secondary"
            onClick={() => setFaqMode("list")}
          >
            Back
          </button>
        </div>
        {error ? (
          <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        ) : null}
        {success ? (
          <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {success}
          </p>
        ) : null}

        <div className="grid gap-4 max-w-3xl">
          <label className="block">
            <span className="admin-label">Category</span>
            <select
              className="admin-input mt-1 w-full"
              value={faqCategoryId}
              disabled={!canManage || saving}
              onChange={(e) => setFaqCategoryId(e.target.value)}
            >
              <option value="">Select category</option>
              {categoryOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.key}
                  {!c.is_active ? " (inactive)" : ""}
                </option>
              ))}
            </select>
          </label>
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="block">
              <span className="admin-label">Display order</span>
              <input
                className="admin-input mt-1 w-full"
                value={faqSort}
                disabled={!canManage || saving}
                onChange={(e) => setFaqSort(e.target.value)}
              />
            </label>
            <label className="flex items-end gap-2 pb-2">
              <input
                type="checkbox"
                checked={faqPopular}
                disabled={!canManage || saving}
                onChange={(e) => setFaqPopular(e.target.checked)}
              />
              <span className="admin-label">Popular FAQ</span>
            </label>
            {faqActive ? (
              <div className="text-sm text-slate-600 self-end pb-2">
                Status:{" "}
                <span
                  className={
                    faqActive.status === "published"
                      ? "font-semibold text-emerald-700"
                      : "font-semibold text-amber-700"
                  }
                >
                  {faqActive.status}
                </span>
              </div>
            ) : null}
          </div>
          <label className="block">
            <span className="admin-label">Keywords (comma-separated)</span>
            <input
              className="admin-input mt-1 w-full"
              value={faqKeywords}
              disabled={!canManage || saving}
              onChange={(e) => setFaqKeywords(e.target.value)}
            />
          </label>

          {faqMode === "create" ? (
            <>
              <label className="block">
                <span className="admin-label">Question (English)</span>
                <input
                  className="admin-input mt-1 w-full"
                  value={faqQuestionEn}
                  disabled={!canManage || saving}
                  onChange={(e) => {
                    setFaqQuestionEn(e.target.value);
                    setLocaleQuestion(e.target.value);
                  }}
                />
              </label>
              <label className="block">
                <span className="admin-label">Answer (English)</span>
                <textarea
                  className="admin-input mt-1 w-full min-h-[140px]"
                  value={faqAnswerEn}
                  disabled={!canManage || saving}
                  onChange={(e) => {
                    setFaqAnswerEn(e.target.value);
                    setLocaleAnswer(e.target.value);
                  }}
                />
              </label>
            </>
          ) : null}

          {canManage ? (
            <button
              type="button"
              className="admin-btn admin-btn-primary w-fit"
              disabled={saving}
              onClick={() => void saveFaqMeta()}
            >
              {saving
                ? "Saving…"
                : faqMode === "create"
                  ? "Create draft FAQ"
                  : "Save FAQ details"}
            </button>
          ) : null}
        </div>

        {faqMode === "edit" && faqActive ? (
          <div className="mt-8 border-t border-slate-200 pt-6">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-base font-bold text-slate-900">Translations</h3>
              <div className="flex flex-wrap gap-2 text-xs">
                {LOCALES.map((l) => {
                  const present = translations.some((t) => t.locale === l.code);
                  return (
                    <span
                      key={l.code}
                      className={`rounded-full px-2 py-1 ${
                        present
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {l.label}: {present ? "ready" : "missing"}
                    </span>
                  );
                })}
              </div>
            </div>
            <div className="mb-3 flex flex-wrap gap-2">
              {LOCALES.map((l) => (
                <button
                  key={l.code}
                  type="button"
                  className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
                    activeLocale === l.code
                      ? "bg-slate-900 text-white"
                      : "bg-slate-100 text-slate-700"
                  }`}
                  onClick={() => selectLocaleTab(l.code)}
                >
                  {l.label}
                </button>
              ))}
              <button
                type="button"
                className="admin-btn admin-btn-secondary"
                onClick={() => setPreviewLocale(activeLocale)}
              >
                Preview
              </button>
            </div>
            {activeLocale !== "en" ? (
              <p className="mb-2 text-xs text-slate-500">
                Saving {activeLocale.toUpperCase()} does not modify the English translation.
              </p>
            ) : null}
            <label className="block mb-3">
              <span className="admin-label">Question ({activeLocale})</span>
              <input
                className="admin-input mt-1 w-full"
                value={localeQuestion}
                disabled={!canManage || saving}
                onChange={(e) => setLocaleQuestion(e.target.value)}
              />
            </label>
            <label className="block mb-3">
              <span className="admin-label">Answer ({activeLocale})</span>
              <textarea
                className="admin-input mt-1 w-full min-h-[160px]"
                value={localeAnswer}
                disabled={!canManage || saving}
                onChange={(e) => setLocaleAnswer(e.target.value)}
              />
            </label>
            {canManage ? (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="admin-btn admin-btn-primary"
                  disabled={saving}
                  onClick={() => void saveTranslation()}
                >
                  {saving ? "Saving…" : `Save ${activeLocale.toUpperCase()} only`}
                </button>
                {faqActive.status === "published" ? (
                  <button
                    type="button"
                    className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white"
                    onClick={() => void unpublishFaq(faqActive)}
                  >
                    Unpublish
                  </button>
                ) : (
                  <button
                    type="button"
                    className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white"
                    onClick={() => void publishFaq(faqActive)}
                  >
                    Publish
                  </button>
                )}
                <button
                  type="button"
                  className="rounded-xl bg-red-100 px-4 py-2 text-sm font-semibold text-red-700"
                  onClick={() => void deleteFaq(faqActive)}
                >
                  Delete FAQ
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {previewLocale && previewTranslation ? (
          <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="mb-2 flex justify-between">
              <h4 className="font-semibold text-slate-900">
                Preview ({previewLocale})
              </h4>
              <button
                type="button"
                className="text-sm text-slate-600"
                onClick={() => setPreviewLocale(null)}
              >
                Close
              </button>
            </div>
            <p className="mb-2 text-lg font-semibold text-slate-900">
              {previewTranslation.question}
            </p>
            <p className="whitespace-pre-wrap text-slate-700">
              {previewTranslation.answer}
            </p>
          </div>
        ) : null}
      </div>
    );
  }

  if (catMode === "create" || catMode === "edit") {
    return (
      <div className="admin-card p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-slate-900">
            {catMode === "create" ? "Create Category" : "Edit Category"}
          </h2>
          <button
            type="button"
            className="admin-btn admin-btn-secondary"
            onClick={() => setCatMode("list")}
          >
            Back
          </button>
        </div>
        {error ? (
          <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        ) : null}
        <div className="grid gap-4 max-w-xl">
          <label className="block">
            <span className="admin-label">Key (slug)</span>
            <input
              className="admin-input mt-1 w-full"
              value={catKey}
              disabled={!canManage || saving}
              onChange={(e) => setCatKey(e.target.value)}
              placeholder="e.g. account_registration"
            />
          </label>
          <label className="block">
            <span className="admin-label">Display order</span>
            <input
              className="admin-input mt-1 w-full"
              value={catSort}
              disabled={!canManage || saving}
              onChange={(e) => setCatSort(e.target.value)}
            />
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={catActiveFlag}
              disabled={!canManage || saving}
              onChange={(e) => setCatActiveFlag(e.target.checked)}
            />
            <span className="admin-label">Active (required for Mobile visibility)</span>
          </label>
          {canManage ? (
            <button
              type="button"
              className="admin-btn admin-btn-primary w-fit"
              disabled={saving}
              onClick={() => void saveCategory()}
            >
              {saving ? "Saving…" : "Save category"}
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <button
            type="button"
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
              subTab === "faqs" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"
            }`}
            onClick={() => setSubTab("faqs")}
          >
            FAQs
          </button>
          <button
            type="button"
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
              subTab === "categories"
                ? "bg-slate-900 text-white"
                : "bg-slate-100 text-slate-700"
            }`}
            onClick={() => setSubTab("categories")}
          >
            Categories
          </button>
        </div>
        {canManage ? (
          <button
            type="button"
            className="rounded-xl bg-indigo-700 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-800"
            onClick={() => (subTab === "faqs" ? openCreateFaq() : openCreateCategory())}
          >
            {subTab === "faqs" ? "Create FAQ" : "Create Category"}
          </button>
        ) : null}
      </div>

      {error ? (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}
      {success ? (
        <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {success}
        </p>
      ) : null}

      {subTab === "faqs" ? (
        <>
          <form
            className="mb-4 flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setPage(1);
              setQ(searchInput.trim());
            }}
          >
            <input
              className="admin-input min-w-[200px]"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search question / keywords"
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
              <option value="draft">Draft</option>
              <option value="published">Published</option>
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
              {categoryOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.key}
                </option>
              ))}
            </select>
            <button type="submit" className="admin-btn admin-btn-secondary">
              Search
            </button>
          </form>

          <div className="admin-table-wrap">
            <div className="overflow-x-auto">
              <table className="admin-table">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase text-slate-600">
                      Question (EN)
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase text-slate-600">
                      Category
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase text-slate-600">
                      Status
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase text-slate-600">
                      Translations
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase text-slate-600">
                      Order
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase text-slate-600">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                        Loading…
                      </td>
                    </tr>
                  ) : faqs.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                        No FAQs yet. Create one to seed Help Center content.
                      </td>
                    </tr>
                  ) : (
                    faqs.map((row) => (
                      <tr key={row.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-medium text-slate-800 max-w-xs">
                          <div className="truncate">
                            {row.question_en ?? "(no English question)"}
                          </div>
                          {row.is_popular ? (
                            <span className="mt-1 inline-block rounded bg-violet-100 px-2 py-0.5 text-xs text-violet-800">
                              Popular
                            </span>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          {row.help_faq_categories?.key ?? "—"}
                          {row.help_faq_categories &&
                          !row.help_faq_categories.is_active ? (
                            <span className="ml-1 text-xs text-amber-700">
                              (inactive)
                            </span>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`rounded px-2 py-0.5 text-xs font-semibold ${
                              row.status === "published"
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-amber-100 text-amber-800"
                            }`}
                          >
                            {row.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-700">
                          {(row.translation_locales ?? []).join(", ") || "—"}
                          {(row.missing_locales?.length ?? 0) > 0 ? (
                            <div className="text-xs text-amber-700">
                              missing: {row.missing_locales?.join(", ")}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-slate-600">{row.sort_order}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              className="rounded bg-slate-100 px-3 py-1 text-slate-700"
                              onClick={() => void openEditFaq(row)}
                            >
                              {canManage ? "Edit" : "View"}
                            </button>
                            {canManage && row.status !== "published" ? (
                              <button
                                type="button"
                                className="rounded bg-emerald-100 px-3 py-1 text-emerald-800"
                                onClick={() => void publishFaq(row)}
                              >
                                Publish
                              </button>
                            ) : null}
                            {canManage && row.status === "published" ? (
                              <button
                                type="button"
                                className="rounded bg-amber-100 px-3 py-1 text-amber-800"
                                onClick={() => void unpublishFaq(row)}
                              >
                                Unpublish
                              </button>
                            ) : null}
                            {canManage ? (
                              <button
                                type="button"
                                className="rounded bg-red-100 px-3 py-1 text-red-700"
                                onClick={() => void deleteFaq(row)}
                              >
                                Delete
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
          </div>

          <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
            <span>
              Page {page} of {totalPages} ({faqTotal} total)
            </span>
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
        </>
      ) : (
        <div className="admin-table-wrap">
          <div className="overflow-x-auto">
            <table className="admin-table">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase text-slate-600">
                    Key
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase text-slate-600">
                    Order
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase text-slate-600">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase text-slate-600">
                    FAQs
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase text-slate-600">
                    Updated
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase text-slate-600">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                      Loading…
                    </td>
                  </tr>
                ) : categories.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                      No categories found.
                    </td>
                  </tr>
                ) : (
                  categories.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-semibold text-slate-800">{row.key}</td>
                      <td className="px-4 py-3 text-slate-700">{row.sort_order}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded px-2 py-0.5 text-xs font-semibold ${
                            row.is_active
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-slate-200 text-slate-700"
                          }`}
                        >
                          {row.is_active ? "active" : "inactive"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{row.faq_count ?? 0}</td>
                      <td className="px-4 py-3 text-sm text-slate-600">
                        {formatDt(row.updated_at)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          {canManage ? (
                            <>
                              <button
                                type="button"
                                className="rounded bg-amber-100 px-3 py-1 text-amber-800"
                                onClick={() => openEditCategory(row)}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                className="rounded bg-red-100 px-3 py-1 text-red-700"
                                onClick={() => void deleteCategory(row)}
                              >
                                Delete
                              </button>
                            </>
                          ) : (
                            <span className="text-sm text-slate-500">View only</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
