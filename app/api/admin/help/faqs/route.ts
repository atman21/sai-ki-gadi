import { NextResponse } from "next/server";

import { requireAdminPermission } from "@/lib/admin-api";
import {
  clientMetaFromRequest,
  recordFailure,
  recordSuccess,
} from "@/lib/admin-audit";
import {
  isFaqStatus,
  parseBool,
  parseKeywords,
  parseSortOrder,
  validateTranslationText,
} from "@/lib/help-center";
import { supabaseAdmin } from "@/lib/supabase-admin";

const FAQ_LIST_SELECT = `
  id, category_id, status, sort_order, keywords, is_popular, published_at,
  created_by, updated_by, created_at, updated_at,
  help_faq_categories ( id, key, is_active, sort_order ),
  help_faq_translations ( locale, question )
`;

export async function GET(request: Request) {
  const gate = await requireAdminPermission("help.view", {
    request,
    auditModule: "help",
  });
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const status = url.searchParams.get("status");
  const categoryId = url.searchParams.get("categoryId");
  const popular = url.searchParams.get("popular");
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, Number(url.searchParams.get("pageSize") ?? "20") || 20),
  );
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let faqIdsFilter: string[] | null = null;
  if (q) {
    const safe = q.replace(/[%_,]/g, " ").trim();
    const { data: trHits, error: trErr } = await supabaseAdmin
      .from("help_faq_translations")
      .select("faq_id")
      .or(`question.ilike.%${safe}%,answer.ilike.%${safe}%`)
      .limit(500);
    if (trErr) {
      return NextResponse.json({ ok: false, error: trErr.message }, { status: 500 });
    }
    faqIdsFilter = [...new Set((trHits ?? []).map((r) => String(r.faq_id)))];
    if (faqIdsFilter.length === 0) {
      return NextResponse.json({
        ok: true,
        rows: [],
        page,
        pageSize,
        total: 0,
      });
    }
  }

  let query = supabaseAdmin
    .from("help_faqs")
    .select(FAQ_LIST_SELECT, { count: "exact" })
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (status && isFaqStatus(status)) {
    query = query.eq("status", status);
  }
  if (categoryId) {
    query = query.eq("category_id", categoryId);
  }
  if (popular === "true" || popular === "false") {
    query = query.eq("is_popular", popular === "true");
  }
  if (faqIdsFilter) {
    query = query.in("id", faqIdsFilter);
  }

  const { data, error, count } = await query;
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const rows = data ?? [];

  const enriched = rows.map((row) => {
    const translations = Array.isArray(row.help_faq_translations)
      ? row.help_faq_translations
      : [];
    const locales = translations.map((t: { locale: string }) => t.locale);
    const en = translations.find((t: { locale: string }) => t.locale === "en");
    return {
      ...row,
      translation_locales: locales,
      missing_locales: (["en", "hi", "gu"] as const).filter(
        (l) => !locales.includes(l),
      ),
      question_en: en?.question ?? null,
    };
  });

  return NextResponse.json({
    ok: true,
    rows: enriched,
    page,
    pageSize,
    total: count ?? 0,
  });
}

export async function POST(request: Request) {
  const gate = await requireAdminPermission("help.manage", {
    request,
    auditModule: "help",
  });
  if (!gate.ok) return gate.response;

  try {
    const body = await request.json();
    const categoryId =
      typeof body?.category_id === "string" ? body.category_id.trim() : "";
    if (!categoryId) {
      return NextResponse.json(
        { ok: false, error: "category_id is required." },
        { status: 400 },
      );
    }

    const { data: category } = await supabaseAdmin
      .from("help_faq_categories")
      .select("id, key, is_active")
      .eq("id", categoryId)
      .maybeSingle();
    if (!category) {
      return NextResponse.json(
        { ok: false, error: "Category not found." },
        { status: 400 },
      );
    }

    const sort = parseSortOrder(body?.sort_order, 0);
    if (!sort.ok) {
      return NextResponse.json({ ok: false, error: sort.error }, { status: 400 });
    }
    const keywords = parseKeywords(body?.keywords);
    if (!keywords.ok) {
      return NextResponse.json(
        { ok: false, error: keywords.error },
        { status: 400 },
      );
    }
    const isPopular = parseBool(body?.is_popular, false);
    const status =
      body?.status === "published" ? "published" : ("draft" as const);

    const question = validateTranslationText("question", body?.question_en ?? body?.question);
    const answer = validateTranslationText("answer", body?.answer_en ?? body?.answer);
    if (!question.ok) {
      return NextResponse.json({ ok: false, error: question.error }, { status: 400 });
    }
    if (!answer.ok) {
      return NextResponse.json({ ok: false, error: answer.error }, { status: 400 });
    }

    if (status === "published" && !category.is_active) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Cannot publish FAQ while its category is inactive. Activate the category first.",
        },
        { status: 400 },
      );
    }

    const now = new Date().toISOString();
    const { data: faq, error } = await supabaseAdmin
      .from("help_faqs")
      .insert({
        category_id: categoryId,
        status,
        sort_order: sort.value,
        keywords: keywords.value,
        is_popular: isPopular,
        published_at: status === "published" ? now : null,
        created_by: gate.actor.id ?? null,
        updated_by: gate.actor.id ?? null,
      })
      .select(
        "id, category_id, status, sort_order, keywords, is_popular, published_at, created_by, updated_by, created_at, updated_at",
      )
      .single();

    if (error || !faq) {
      void recordFailure({
        actor: gate.actor,
        action: "help.faq.create",
        module: "help",
        description: "Failed to create FAQ",
        resourceType: "help_faq",
        reason: error?.message ?? "unknown",
        ...clientMetaFromRequest(request),
      });
      return NextResponse.json(
        { ok: false, error: error?.message ?? "Create failed" },
        { status: 400 },
      );
    }

    const { error: trError } = await supabaseAdmin
      .from("help_faq_translations")
      .insert({
        faq_id: faq.id,
        locale: "en",
        question: question.value,
        answer: answer.value,
      });

    if (trError) {
      await supabaseAdmin.from("help_faqs").delete().eq("id", faq.id);
      void recordFailure({
        actor: gate.actor,
        action: "help.faq.create",
        module: "help",
        description: "Failed to create English translation for FAQ",
        resourceType: "help_faq",
        resourceId: faq.id,
        reason: trError.message,
        ...clientMetaFromRequest(request),
      });
      return NextResponse.json(
        { ok: false, error: trError.message },
        { status: 400 },
      );
    }

    void recordSuccess({
      actor: gate.actor,
      action: "help.faq.create",
      module: "help",
      description: `FAQ created (${status})`,
      resourceType: "help_faq",
      resourceId: faq.id,
      afterData: { ...faq, question_en: question.value },
      ...clientMetaFromRequest(request),
    });

    return NextResponse.json({ ok: true, row: faq });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Internal error" },
      { status: 500 },
    );
  }
}
