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
import { canPublishFaq, faqAuditSnapshot } from "@/lib/help-faq-admin";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST — publish FAQ (help.manage). Requires English translation.
 */
export async function POST(request: Request, context: Ctx) {
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
    const { data: existing, error } = await gate.supabase
      .from("help_faqs")
      .select(
        "id, category_id, status, sort_order, keywords, is_popular, published_at, help_faq_translations ( locale )",
      )
      .eq("id", id)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { ok: false, error: safeErrorMessage(error, "Failed to load FAQ.") },
        { status: 500 },
      );
    }
    if (!existing) {
      return NextResponse.json({ ok: false, error: "FAQ not found." }, { status: 404 });
    }

    const locales = (
      Array.isArray(existing.help_faq_translations)
        ? existing.help_faq_translations
        : existing.help_faq_translations
          ? [existing.help_faq_translations]
          : []
    )
      .map((row: { locale?: string }) => String(row?.locale ?? ""))
      .filter(Boolean);

    if (!canPublishFaq(locales)) {
      return NextResponse.json(
        {
          ok: false,
          error: "English (en) translation is required before publishing.",
        },
        { status: 400 },
      );
    }

    if (existing.status === "published") {
      return NextResponse.json({ ok: true, id, status: "published" });
    }

    const publishedAt = new Date().toISOString();
    const { error: updateError } = await gate.supabase
      .from("help_faqs")
      .update({
        status: "published",
        published_at: publishedAt,
        updated_by: gate.actor.id,
      })
      .eq("id", id);

    if (updateError) {
      void recordFailure({
        ...auditBase,
        action: "help.faq.publish",
        description: `Failed to publish Help FAQ ${id}`,
        reason: updateError.message,
      });
      return NextResponse.json(
        {
          ok: false,
          error: safeErrorMessage(updateError, "Failed to publish FAQ."),
        },
        { status: 500 },
      );
    }

    void recordChange({
      ...auditBase,
      action: "help.faq.publish",
      description: `Published Help FAQ ${id}`,
      changedFields: ["status", "published_at"],
      beforeData: faqAuditSnapshot({
        id,
        category_id: existing.category_id,
        status: existing.status,
        sort_order: existing.sort_order,
        is_popular: existing.is_popular,
        keywords: existing.keywords as string[],
        published_at: existing.published_at,
        locales,
      }),
      afterData: faqAuditSnapshot({
        id,
        category_id: existing.category_id,
        status: "published",
        sort_order: existing.sort_order,
        is_popular: existing.is_popular,
        keywords: existing.keywords as string[],
        published_at: publishedAt,
        locales,
      }),
    });

    return NextResponse.json({ ok: true, id, status: "published" });
  } catch {
    void recordFailure({
      ...auditBase,
      action: "help.faq.publish",
      description: `Failed to publish Help FAQ ${id}`,
      reason: "unexpected",
    });
    return NextResponse.json(
      { ok: false, error: "Failed to publish FAQ." },
      { status: 500 },
    );
  }
}
