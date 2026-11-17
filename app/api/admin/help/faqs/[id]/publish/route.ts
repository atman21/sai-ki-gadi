import { NextResponse } from "next/server";

import { requireAdminPermission } from "@/lib/admin-api";
import {
  clientMetaFromRequest,
  recordFailure,
  recordSuccess,
} from "@/lib/admin-audit";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function POST(
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

    const { data: faq } = await supabaseAdmin
      .from("help_faqs")
      .select(
        "id, category_id, status, published_at, help_faq_categories ( id, key, is_active )",
      )
      .eq("id", id)
      .maybeSingle();

    if (!faq) {
      return NextResponse.json({ ok: false, error: "FAQ not found." }, { status: 404 });
    }

    const categoryRaw = faq.help_faq_categories as
      | { id: string; key: string; is_active: boolean }
      | { id: string; key: string; is_active: boolean }[]
      | null;
    const category = Array.isArray(categoryRaw)
      ? categoryRaw[0] ?? null
      : categoryRaw;
    if (!category?.is_active) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Cannot publish: category is inactive. Activate the category so Mobile can receive this FAQ.",
        },
        { status: 400 },
      );
    }

    const { data: translations } = await supabaseAdmin
      .from("help_faq_translations")
      .select("locale")
      .eq("faq_id", id);

    const locales = (translations ?? []).map((t) => t.locale as string);
    if (!locales.includes("en")) {
      return NextResponse.json(
        {
          ok: false,
          error: "English translation is required before publishing.",
        },
        { status: 400 },
      );
    }

    const now = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from("help_faqs")
      .update({
        status: "published",
        published_at: faq.published_at ?? now,
        updated_by: gate.actor.id ?? null,
      })
      .eq("id", id)
      .select(
        "id, category_id, status, sort_order, keywords, is_popular, published_at, updated_at",
      )
      .single();

    if (error) {
      void recordFailure({
        actor: gate.actor,
        action: "help.faq.publish",
        module: "help",
        description: "Failed to publish FAQ",
        resourceType: "help_faq",
        resourceId: id,
        reason: error.message,
        ...clientMetaFromRequest(request),
      });
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }

    void recordSuccess({
      actor: gate.actor,
      action: "help.faq.publish",
      module: "help",
      description: `FAQ published (category ${category.key})`,
      resourceType: "help_faq",
      resourceId: id,
      afterData: {
        ...data,
        translation_locales: locales,
        missing_locales: (["en", "hi", "gu"] as const).filter(
          (l) => !locales.includes(l),
        ),
      },
      ...clientMetaFromRequest(request),
    });

    return NextResponse.json({
      ok: true,
      row: data,
      translation_locales: locales,
      missing_locales: (["en", "hi", "gu"] as const).filter(
        (l) => !locales.includes(l),
      ),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Internal error" },
      { status: 500 },
    );
  }
}
