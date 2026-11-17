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
} from "@/lib/help-center";
import { supabaseAdmin } from "@/lib/supabase-admin";

const FAQ_DETAIL_SELECT = `
  id, category_id, status, sort_order, keywords, is_popular, published_at,
  created_by, updated_by, created_at, updated_at,
  help_faq_categories ( id, key, is_active, sort_order ),
  help_faq_translations ( id, locale, question, answer, created_at, updated_at )
`;

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const gate = await requireAdminPermission("help.view", {
    request,
    auditModule: "help",
  });
  if (!gate.ok) return gate.response;

  const { id } = await context.params;
  const { data, error } = await supabaseAdmin
    .from("help_faqs")
    .select(FAQ_DETAIL_SELECT)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ ok: false, error: "FAQ not found." }, { status: 404 });
  }

  const translations = Array.isArray(data.help_faq_translations)
    ? data.help_faq_translations
    : [];
  const locales = translations.map((t: { locale: string }) => t.locale);

  return NextResponse.json({
    ok: true,
    row: {
      ...data,
      translation_locales: locales,
      missing_locales: (["en", "hi", "gu"] as const).filter(
        (l) => !locales.includes(l),
      ),
    },
  });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const gate = await requireAdminPermission("help.manage", {
    request,
    auditModule: "help",
  });
  if (!gate.ok) return gate.response;

  try {
    const { id } = await context.params;
    const body = await request.json();

    const { data: before } = await supabaseAdmin
      .from("help_faqs")
      .select(
        "id, category_id, status, sort_order, keywords, is_popular, published_at, created_by, updated_by, created_at, updated_at",
      )
      .eq("id", id)
      .maybeSingle();

    if (!before) {
      return NextResponse.json({ ok: false, error: "FAQ not found." }, { status: 404 });
    }

    const patch: Record<string, unknown> = {
      updated_by: gate.actor.id ?? null,
    };

    if (body?.category_id !== undefined) {
      const categoryId = String(body.category_id).trim();
      const { data: category } = await supabaseAdmin
        .from("help_faq_categories")
        .select("id, is_active")
        .eq("id", categoryId)
        .maybeSingle();
      if (!category) {
        return NextResponse.json(
          { ok: false, error: "Category not found." },
          { status: 400 },
        );
      }
      if (before.status === "published" && !category.is_active) {
        return NextResponse.json(
          {
            ok: false,
            error: "Cannot assign a published FAQ to an inactive category.",
          },
          { status: 400 },
        );
      }
      patch.category_id = categoryId;
    }

    if (body?.sort_order !== undefined) {
      const sort = parseSortOrder(body.sort_order, before.sort_order);
      if (!sort.ok) {
        return NextResponse.json({ ok: false, error: sort.error }, { status: 400 });
      }
      patch.sort_order = sort.value;
    }

    if (body?.keywords !== undefined) {
      const keywords = parseKeywords(body.keywords);
      if (!keywords.ok) {
        return NextResponse.json(
          { ok: false, error: keywords.error },
          { status: 400 },
        );
      }
      patch.keywords = keywords.value;
    }

    if (body?.is_popular !== undefined) {
      patch.is_popular = parseBool(body.is_popular, before.is_popular);
    }

    // Status changes should use publish/unpublish endpoints for audit clarity,
    // but allow draft/published here when explicitly sent.
    if (body?.status !== undefined) {
      if (!isFaqStatus(body.status)) {
        return NextResponse.json(
          { ok: false, error: "status must be draft or published." },
          { status: 400 },
        );
      }
      if (body.status === "published") {
        const catId = (patch.category_id as string | undefined) ?? before.category_id;
        const { data: category } = await supabaseAdmin
          .from("help_faq_categories")
          .select("id, is_active")
          .eq("id", catId)
          .maybeSingle();
        if (!category?.is_active) {
          return NextResponse.json(
            {
              ok: false,
              error: "Cannot publish FAQ while its category is inactive.",
            },
            { status: 400 },
          );
        }
        const { data: en } = await supabaseAdmin
          .from("help_faq_translations")
          .select("id")
          .eq("faq_id", id)
          .eq("locale", "en")
          .maybeSingle();
        if (!en) {
          return NextResponse.json(
            {
              ok: false,
              error: "English translation is required before publishing.",
            },
            { status: 400 },
          );
        }
        patch.status = "published";
        patch.published_at = before.published_at ?? new Date().toISOString();
      } else {
        patch.status = "draft";
        patch.published_at = null;
      }
    }

    const { data, error } = await supabaseAdmin
      .from("help_faqs")
      .update(patch)
      .eq("id", id)
      .select(
        "id, category_id, status, sort_order, keywords, is_popular, published_at, created_by, updated_by, created_at, updated_at",
      )
      .single();

    if (error) {
      void recordFailure({
        actor: gate.actor,
        action: "help.faq.update",
        module: "help",
        description: "Failed to update FAQ",
        resourceType: "help_faq",
        resourceId: id,
        reason: error.message,
        ...clientMetaFromRequest(request),
      });
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }

    void recordSuccess({
      actor: gate.actor,
      action: "help.faq.update",
      module: "help",
      description: "FAQ updated",
      resourceType: "help_faq",
      resourceId: id,
      beforeData: before,
      afterData: data ?? undefined,
      ...clientMetaFromRequest(request),
    });

    return NextResponse.json({ ok: true, row: data });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Internal error" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const gate = await requireAdminPermission("help.manage", {
    request,
    auditModule: "help",
  });
  if (!gate.ok) return gate.response;

  try {
    const { id } = await context.params;
    const { data: before } = await supabaseAdmin
      .from("help_faqs")
      .select(
        "id, category_id, status, sort_order, keywords, is_popular, published_at",
      )
      .eq("id", id)
      .maybeSingle();

    if (!before) {
      return NextResponse.json({ ok: false, error: "FAQ not found." }, { status: 404 });
    }

    // Translations cascade via FK on delete.
    const { error } = await supabaseAdmin.from("help_faqs").delete().eq("id", id);
    if (error) {
      void recordFailure({
        actor: gate.actor,
        action: "help.faq.delete",
        module: "help",
        description: "Failed to delete FAQ",
        resourceType: "help_faq",
        resourceId: id,
        reason: error.message,
        ...clientMetaFromRequest(request),
      });
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }

    void recordSuccess({
      actor: gate.actor,
      action: "help.faq.delete",
      module: "help",
      description: "FAQ deleted",
      resourceType: "help_faq",
      resourceId: id,
      beforeData: before,
      ...clientMetaFromRequest(request),
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Internal error" },
      { status: 500 },
    );
  }
}
