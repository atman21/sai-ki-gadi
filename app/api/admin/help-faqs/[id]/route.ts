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
import { isAdminUuid } from "@/lib/admin-uuid";
import {
  categoryLabel,
  faqAuditSnapshot,
  isHelpFaqStatus,
  mergeLocalePresence,
  parseKeywords,
  parseTranslationInputs,
} from "@/lib/help-faq-admin";

const FAQ_DETAIL_SELECT = `
  id,
  category_id,
  status,
  sort_order,
  keywords,
  is_popular,
  published_at,
  created_at,
  updated_at,
  created_by,
  updated_by,
  help_faq_categories ( id, key, sort_order, is_active ),
  help_faq_translations ( id, locale, question, answer, updated_at )
`;

type Ctx = { params: Promise<{ id: string }> };

function asCategory(value: unknown) {
  if (!value) return null;
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  return {
    id: String(r.id ?? ""),
    key: String(r.key ?? ""),
    label: categoryLabel(String(r.key ?? "")),
    sort_order: Number(r.sort_order ?? 0),
    is_active: r.is_active !== false,
  };
}

function asTranslations(value: unknown) {
  if (!value) return [];
  const rows = Array.isArray(value) ? value : [value];
  return rows
    .filter((row) => row && typeof row === "object")
    .map((row) => {
      const r = row as Record<string, unknown>;
      return {
        id: String(r.id ?? ""),
        locale: String(r.locale ?? ""),
        question: String(r.question ?? ""),
        answer: String(r.answer ?? ""),
        updated_at: (r.updated_at as string | null) ?? null,
      };
    })
    .sort((a, b) => a.locale.localeCompare(b.locale));
}

/**
 * GET — single FAQ with all translations (help.view)
 */
export async function GET(request: Request, context: Ctx) {
  const gate = await requireAdminPermission("help.view", {
    request,
    auditModule: "help",
  });
  if (!gate.ok) return gate.response;

  const { id } = await context.params;
  if (!isAdminUuid(id)) {
    return NextResponse.json({ ok: false, error: "Invalid FAQ id." }, { status: 400 });
  }

  try {
    const { data, error } = await gate.supabase
      .from("help_faqs")
      .select(FAQ_DETAIL_SELECT)
      .eq("id", id)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { ok: false, error: safeErrorMessage(error, "Failed to load FAQ.") },
        { status: 500 },
      );
    }
    if (!data) {
      return NextResponse.json({ ok: false, error: "FAQ not found." }, { status: 404 });
    }

    const translations = asTranslations(data.help_faq_translations);
    return NextResponse.json({
      ok: true,
      item: {
        id: data.id,
        category_id: data.category_id,
        category: asCategory(data.help_faq_categories),
        status: data.status,
        sort_order: data.sort_order,
        keywords: data.keywords ?? [],
        is_popular: Boolean(data.is_popular),
        published_at: data.published_at,
        created_at: data.created_at,
        updated_at: data.updated_at,
        created_by: data.created_by,
        updated_by: data.updated_by,
        translations,
        locales: translations.map((t) => t.locale),
      },
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Failed to load FAQ." },
      { status: 500 },
    );
  }
}

/**
 * PUT — update FAQ metadata and/or upsert provided translations (help.manage).
 * Omitted locales are preserved (not deleted).
 */
export async function PUT(request: Request, context: Ctx) {
  const gate = await requireAdminPermission("help.manage", {
    request,
    auditModule: "help",
  });
  if (!gate.ok) return gate.response;

  const { id } = await context.params;
  if (!isAdminUuid(id)) {
    return NextResponse.json({ ok: false, error: "Invalid FAQ id." }, { status: 400 });
  }

  const auditBase = {
    actor: gate.actor,
    module: "help",
    resourceType: "help_faq",
    resourceId: id,
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

    const { data: existing, error: existingError } = await gate.supabase
      .from("help_faqs")
      .select(
        `id, category_id, status, sort_order, keywords, is_popular, published_at,
         help_faq_translations ( locale )`,
      )
      .eq("id", id)
      .maybeSingle();

    if (existingError) {
      return NextResponse.json(
        {
          ok: false,
          error: safeErrorMessage(existingError, "Failed to load FAQ."),
        },
        { status: 500 },
      );
    }
    if (!existing) {
      return NextResponse.json({ ok: false, error: "FAQ not found." }, { status: 404 });
    }

    const existingLocales = asTranslations(existing.help_faq_translations).map(
      (t) => t.locale,
    );

    const patch: Record<string, unknown> = {
      updated_by: gate.actor.id,
    };
    const changedFields: string[] = [];

    if (body.category_id !== undefined) {
      const categoryId =
        typeof body.category_id === "string" ? body.category_id.trim() : "";
      if (!isAdminUuid(categoryId)) {
        return NextResponse.json(
          { ok: false, error: "Valid category_id is required." },
          { status: 400 },
        );
      }
      const { data: category } = await gate.supabase
        .from("help_faq_categories")
        .select("id, is_active")
        .eq("id", categoryId)
        .maybeSingle();
      if (!category || category.is_active === false) {
        return NextResponse.json(
          { ok: false, error: "Category not found or inactive." },
          { status: 400 },
        );
      }
      if (categoryId !== existing.category_id) {
        patch.category_id = categoryId;
        changedFields.push("category_id");
      }
    }

    if (body.sort_order !== undefined) {
      const sortOrder = Number(body.sort_order);
      if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 100000) {
        return NextResponse.json(
          { ok: false, error: "sort_order must be an integer 0–100000." },
          { status: 400 },
        );
      }
      if (sortOrder !== existing.sort_order) {
        patch.sort_order = sortOrder;
        changedFields.push("sort_order");
      }
    }

    if (body.is_popular !== undefined) {
      const isPopular = body.is_popular === true;
      if (isPopular !== Boolean(existing.is_popular)) {
        patch.is_popular = isPopular;
        changedFields.push("is_popular");
      }
    }

    if (body.keywords !== undefined) {
      const keywords = parseKeywords(body.keywords);
      if (keywords == null) {
        return NextResponse.json(
          { ok: false, error: "Invalid keywords." },
          { status: 400 },
        );
      }
      patch.keywords = keywords;
      changedFields.push("keywords");
    }

    // Status changes must use publish/unpublish endpoints for correct audit actions.
    if (body.status !== undefined) {
      if (!isHelpFaqStatus(body.status)) {
        return NextResponse.json(
          { ok: false, error: "status must be draft or published." },
          { status: 400 },
        );
      }
      return NextResponse.json(
        {
          ok: false,
          error:
            "Use /publish or /unpublish endpoints to change publication status.",
        },
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

    if (changedFields.length === 0 && parsedTranslations.translations.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No changes provided." },
        { status: 400 },
      );
    }

    if (Object.keys(patch).length > 1 || changedFields.length > 0) {
      const { error: updateError } = await gate.supabase
        .from("help_faqs")
        .update(patch)
        .eq("id", id);
      if (updateError) {
        void recordFailure({
          ...auditBase,
          action: "help.faq.update",
          description: `Failed to update Help FAQ ${id}`,
          reason: updateError.message,
        });
        return NextResponse.json(
          {
            ok: false,
            error: safeErrorMessage(updateError, "Failed to update FAQ."),
          },
          { status: 500 },
        );
      }
    }

    if (parsedTranslations.translations.length > 0) {
      const rows = parsedTranslations.translations.map((t) => ({
        faq_id: id,
        locale: t.locale,
        question: t.question,
        answer: t.answer,
      }));
      const { error: upsertError } = await gate.supabase
        .from("help_faq_translations")
        .upsert(rows, { onConflict: "faq_id,locale" });
      if (upsertError) {
        void recordFailure({
          ...auditBase,
          action: "help.faq.update",
          description: `Failed to update Help FAQ translations ${id}`,
          reason: upsertError.message,
        });
        return NextResponse.json(
          {
            ok: false,
            error: safeErrorMessage(
              upsertError,
              "Failed to update FAQ translations.",
            ),
          },
          { status: 500 },
        );
      }
      changedFields.push("translations");
    }

    // Touch updated_by even when only translations changed
    if (
      parsedTranslations.translations.length > 0 &&
      !changedFields.includes("category_id") &&
      Object.keys(patch).length <= 1
    ) {
      await gate.supabase
        .from("help_faqs")
        .update({ updated_by: gate.actor.id })
        .eq("id", id);
    }

    const nextLocales = mergeLocalePresence(
      existingLocales,
      parsedTranslations.translations.map((t) => t.locale),
    );

    void recordChange({
      ...auditBase,
      action: "help.faq.update",
      description: `Updated Help FAQ ${id}`,
      changedFields,
      beforeData: faqAuditSnapshot({
        id,
        category_id: existing.category_id,
        status: existing.status,
        sort_order: existing.sort_order,
        is_popular: existing.is_popular,
        keywords: existing.keywords as string[],
        published_at: existing.published_at,
        locales: existingLocales,
      }),
      afterData: faqAuditSnapshot({
        id,
        category_id: (patch.category_id as string) ?? existing.category_id,
        status: existing.status,
        sort_order: (patch.sort_order as number) ?? existing.sort_order,
        is_popular:
          patch.is_popular !== undefined
            ? Boolean(patch.is_popular)
            : Boolean(existing.is_popular),
        keywords: (patch.keywords as string[]) ?? (existing.keywords as string[]),
        published_at: existing.published_at,
        locales: nextLocales,
      }),
    });

    return NextResponse.json({ ok: true, id });
  } catch {
    void recordFailure({
      ...auditBase,
      action: "help.faq.update",
      description: `Failed to update Help FAQ ${id}`,
      reason: "unexpected",
    });
    return NextResponse.json(
      { ok: false, error: "Failed to update FAQ." },
      { status: 500 },
    );
  }
}
