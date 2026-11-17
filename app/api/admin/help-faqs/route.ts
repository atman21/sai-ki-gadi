import { NextResponse } from "next/server";

import {
  requireAdminPermission,
  safeErrorMessage,
} from "@/lib/admin-api";
import {
  clientMetaFromRequest,
  recordChange,
  recordFailure,
} from "@/lib/admin-audit";
import {
  canPublishFaq,
  categoryLabel,
  faqAuditSnapshot,
  isHelpFaqLocale,
  isHelpFaqStatus,
  parseKeywords,
  parseTranslationInputs,
} from "@/lib/help-faq-admin";
import { isAdminUuid } from "@/lib/admin-uuid";

const FAQ_LIST_SELECT = `
  id,
  category_id,
  status,
  sort_order,
  keywords,
  is_popular,
  published_at,
  created_at,
  updated_at,
  help_faq_categories ( id, key, sort_order, is_active ),
  help_faq_translations ( locale, question, answer, updated_at )
`;

type TranslationEmbed = {
  locale: string;
  question: string;
  answer: string;
  updated_at?: string;
};

function asCategory(
  value: unknown,
): { id: string; key: string; sort_order: number; is_active: boolean } | null {
  if (!value) return null;
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  return {
    id: String(r.id ?? ""),
    key: String(r.key ?? ""),
    sort_order: Number(r.sort_order ?? 0),
    is_active: r.is_active !== false,
  };
}

function asTranslations(value: unknown): TranslationEmbed[] {
  if (!value) return [];
  const rows = Array.isArray(value) ? value : [value];
  return rows
    .filter((row): row is TranslationEmbed => Boolean(row && typeof row === "object"))
    .map((row) => ({
      locale: String(row.locale ?? ""),
      question: String(row.question ?? ""),
      answer: String(row.answer ?? ""),
      updated_at: row.updated_at ? String(row.updated_at) : undefined,
    }));
}

function mapListItem(row: Record<string, unknown>) {
  const category = asCategory(row.help_faq_categories);
  const translations = asTranslations(row.help_faq_translations);
  const locales = translations.map((t) => t.locale).filter(Boolean).sort();
  const primary =
    translations.find((t) => t.locale === "en") ?? translations[0] ?? null;

  return {
    id: String(row.id),
    category_id: String(row.category_id),
    category_key: category?.key ?? null,
    category_label: category ? categoryLabel(category.key) : null,
    status: String(row.status ?? "draft"),
    sort_order: Number(row.sort_order ?? 0),
    keywords: Array.isArray(row.keywords) ? (row.keywords as string[]) : [],
    is_popular: Boolean(row.is_popular),
    published_at: (row.published_at as string | null) ?? null,
    created_at: (row.created_at as string | null) ?? null,
    updated_at: (row.updated_at as string | null) ?? null,
    locales,
    question_preview: primary?.question ?? "",
    answer_preview: primary?.answer ?? "",
  };
}

/**
 * GET — list / search FAQs (help.view)
 * Query: q, status, locale, category_id, page, page_size
 */
export async function GET(request: Request) {
  const gate = await requireAdminPermission("help.view", {
    request,
    auditModule: "help",
  });
  if (!gate.ok) return gate.response;

  try {
    const { searchParams } = new URL(request.url);
    const q = (searchParams.get("q") ?? "").trim().slice(0, 120);
    const statusRaw = searchParams.get("status");
    const localeRaw = searchParams.get("locale");
    const categoryId = searchParams.get("category_id");
    const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, Number(searchParams.get("page_size") ?? "25") || 25),
    );

    if (statusRaw && !isHelpFaqStatus(statusRaw)) {
      return NextResponse.json(
        { ok: false, error: "status must be draft or published." },
        { status: 400 },
      );
    }
    if (localeRaw && !isHelpFaqLocale(localeRaw)) {
      return NextResponse.json(
        { ok: false, error: "locale must be en, hi, or gu." },
        { status: 400 },
      );
    }
    if (categoryId && !isAdminUuid(categoryId)) {
      return NextResponse.json(
        { ok: false, error: "Invalid category_id." },
        { status: 400 },
      );
    }

    let matchingIds: string[] | null = null;
    if (q) {
      const sanitized = q.replace(/[%_]/g, "").trim();
      const pattern = `%${sanitized}%`;
      const [byQuestion, byAnswer] = await Promise.all([
        gate.supabase
          .from("help_faq_translations")
          .select("faq_id")
          .ilike("question", pattern),
        gate.supabase
          .from("help_faq_translations")
          .select("faq_id")
          .ilike("answer", pattern),
      ]);

      if (byQuestion.error || byAnswer.error) {
        return NextResponse.json(
          {
            ok: false,
            error: safeErrorMessage(
              byQuestion.error ?? byAnswer.error,
              "FAQ search failed.",
            ),
          },
          { status: 500 },
        );
      }
      matchingIds = Array.from(
        new Set(
          [...(byQuestion.data ?? []), ...(byAnswer.data ?? [])].map((row) =>
            String(row.faq_id),
          ),
        ),
      );
      if (matchingIds.length === 0) {
        return NextResponse.json({
          ok: true,
          items: [],
          page,
          page_size: pageSize,
          total: 0,
        });
      }
    }

    let query = gate.supabase
      .from("help_faqs")
      .select(FAQ_LIST_SELECT, { count: "exact" })
      .order("updated_at", { ascending: false });

    if (statusRaw) query = query.eq("status", statusRaw);
    if (categoryId) query = query.eq("category_id", categoryId);
    if (matchingIds) query = query.in("id", matchingIds);

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    const { data, error, count } = await query.range(from, to);

    if (error) {
      return NextResponse.json(
        { ok: false, error: safeErrorMessage(error, "Failed to load FAQs.") },
        { status: 500 },
      );
    }

    let items = (data ?? []).map((row) =>
      mapListItem(row as Record<string, unknown>),
    );
    if (localeRaw) {
      items = items.filter((item) => item.locales.includes(localeRaw));
    }

    return NextResponse.json({
      ok: true,
      items,
      page,
      page_size: pageSize,
      total: typeof count === "number" ? count : items.length,
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Failed to load FAQs." },
      { status: 500 },
    );
  }
}

/**
 * POST — create FAQ (help.manage)
 * Body: category_id, translations[], keywords?, sort_order?, is_popular?, status?
 */
export async function POST(request: Request) {
  const gate = await requireAdminPermission("help.manage", {
    request,
    auditModule: "help",
  });
  if (!gate.ok) return gate.response;

  const auditBase = {
    actor: gate.actor,
    module: "help",
    resourceType: "help_faq",
    ...clientMetaFromRequest(request),
  };

  try {
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body) {
      return NextResponse.json(
        { ok: false, error: "Invalid JSON body." },
        { status: 400 },
      );
    }

    const categoryId =
      typeof body.category_id === "string" ? body.category_id.trim() : "";
    if (!isAdminUuid(categoryId)) {
      return NextResponse.json(
        { ok: false, error: "Valid category_id is required." },
        { status: 400 },
      );
    }

    const parsedTranslations = parseTranslationInputs(body.translations);
    if (!parsedTranslations.ok) {
      return NextResponse.json(
        { ok: false, error: parsedTranslations.error },
        { status: 400 },
      );
    }
    if (parsedTranslations.translations.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "At least one translation (en, hi, or gu) is required.",
        },
        { status: 400 },
      );
    }

    const keywords = parseKeywords(body.keywords);
    if (keywords == null) {
      return NextResponse.json(
        { ok: false, error: "Invalid keywords." },
        { status: 400 },
      );
    }

    const sortOrderRaw = body.sort_order;
    const sortOrder =
      sortOrderRaw == null || sortOrderRaw === ""
        ? 0
        : Number(sortOrderRaw);
    if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 100000) {
      return NextResponse.json(
        { ok: false, error: "sort_order must be an integer 0–100000." },
        { status: 400 },
      );
    }

    const isPopular = body.is_popular === true;
    let status = "draft";
    if (body.status != null) {
      if (!isHelpFaqStatus(body.status)) {
        return NextResponse.json(
          { ok: false, error: "status must be draft or published." },
          { status: 400 },
        );
      }
      status = body.status;
    }

    const locales = parsedTranslations.translations.map((t) => t.locale);
    if (status === "published" && !canPublishFaq(locales)) {
      return NextResponse.json(
        {
          ok: false,
          error: "English (en) translation is required before publishing.",
        },
        { status: 400 },
      );
    }

    const { data: category, error: categoryError } = await gate.supabase
      .from("help_faq_categories")
      .select("id, is_active")
      .eq("id", categoryId)
      .maybeSingle();
    if (categoryError || !category) {
      return NextResponse.json(
        { ok: false, error: "Category not found." },
        { status: 400 },
      );
    }
    if (category.is_active === false) {
      return NextResponse.json(
        { ok: false, error: "Category is inactive." },
        { status: 400 },
      );
    }

    const actorId = gate.actor.id;
    const nowIso = new Date().toISOString();

    const { data: created, error: createError } = await gate.supabase
      .from("help_faqs")
      .insert({
        category_id: categoryId,
        status,
        sort_order: sortOrder,
        keywords,
        is_popular: isPopular,
        published_at: status === "published" ? nowIso : null,
        created_by: actorId,
        updated_by: actorId,
      })
      .select("id, category_id, status, sort_order, keywords, is_popular, published_at")
      .single();

    if (createError || !created) {
      void recordFailure({
        ...auditBase,
        action: "help.faq.create",
        description: "Failed to create Help FAQ",
        reason: createError?.message ?? "insert_failed",
      });
      return NextResponse.json(
        {
          ok: false,
          error: safeErrorMessage(createError, "Failed to create FAQ."),
        },
        { status: 500 },
      );
    }

    const translationRows = parsedTranslations.translations.map((t) => ({
      faq_id: created.id,
      locale: t.locale,
      question: t.question,
      answer: t.answer,
    }));

    const { error: translationError } = await gate.supabase
      .from("help_faq_translations")
      .insert(translationRows);

    if (translationError) {
      await gate.supabase.from("help_faqs").delete().eq("id", created.id);
      void recordFailure({
        ...auditBase,
        action: "help.faq.create",
        description: "Failed to create Help FAQ translations",
        resourceId: created.id,
        reason: translationError.message,
      });
      return NextResponse.json(
        {
          ok: false,
          error: safeErrorMessage(
            translationError,
            "Failed to save FAQ translations.",
          ),
        },
        { status: 500 },
      );
    }

    void recordChange({
      ...auditBase,
      action: "help.faq.create",
      description: `Created Help FAQ ${created.id}`,
      resourceId: created.id,
      changedFields: ["category_id", "status", "locales"],
      afterData: faqAuditSnapshot({
        id: created.id,
        category_id: created.category_id,
        status: created.status,
        sort_order: created.sort_order,
        is_popular: created.is_popular,
        keywords: created.keywords as string[],
        published_at: created.published_at,
        locales,
      }),
    });

    return NextResponse.json({ ok: true, id: created.id }, { status: 201 });
  } catch {
    void recordFailure({
      ...auditBase,
      action: "help.faq.create",
      description: "Failed to create Help FAQ",
      reason: "unexpected",
    });
    return NextResponse.json(
      { ok: false, error: "Failed to create FAQ." },
      { status: 500 },
    );
  }
}
