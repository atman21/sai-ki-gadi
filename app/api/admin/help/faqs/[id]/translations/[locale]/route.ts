import { NextResponse } from "next/server";

import { requireAdminPermission } from "@/lib/admin-api";
import {
  clientMetaFromRequest,
  recordFailure,
  recordSuccess,
} from "@/lib/admin-audit";
import {
  isHelpLocale,
  validateTranslationText,
} from "@/lib/help-center";
import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * Upsert a single locale translation without touching other locales.
 * English content is never overwritten when saving hi/gu.
 */
export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string; locale: string }> },
) {
  const gate = await requireAdminPermission("help.manage", {
    request,
    auditModule: "help",
  });
  if (!gate.ok) return gate.response;

  try {
    const { id, locale: localeRaw } = await context.params;
    const locale = localeRaw.toLowerCase();
    if (!isHelpLocale(locale)) {
      return NextResponse.json(
        { ok: false, error: "locale must be en, hi, or gu." },
        { status: 400 },
      );
    }

    const { data: faq } = await supabaseAdmin
      .from("help_faqs")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    if (!faq) {
      return NextResponse.json({ ok: false, error: "FAQ not found." }, { status: 404 });
    }

    const body = await request.json();
    const question = validateTranslationText("question", body?.question);
    const answer = validateTranslationText("answer", body?.answer);
    if (!question.ok) {
      return NextResponse.json({ ok: false, error: question.error }, { status: 400 });
    }
    if (!answer.ok) {
      return NextResponse.json({ ok: false, error: answer.error }, { status: 400 });
    }

    const { data: existing } = await supabaseAdmin
      .from("help_faq_translations")
      .select("id, locale, question, answer")
      .eq("faq_id", id)
      .eq("locale", locale)
      .maybeSingle();

    let row;
    let error;
    if (existing) {
      const result = await supabaseAdmin
        .from("help_faq_translations")
        .update({
          question: question.value,
          answer: answer.value,
        })
        .eq("id", existing.id)
        .select("id, faq_id, locale, question, answer, created_at, updated_at")
        .single();
      row = result.data;
      error = result.error;
    } else {
      const result = await supabaseAdmin
        .from("help_faq_translations")
        .insert({
          faq_id: id,
          locale,
          question: question.value,
          answer: answer.value,
        })
        .select("id, faq_id, locale, question, answer, created_at, updated_at")
        .single();
      row = result.data;
      error = result.error;
    }

    if (error) {
      void recordFailure({
        actor: gate.actor,
        action: "help.faq.update",
        module: "help",
        description: `Failed to save ${locale} translation`,
        resourceType: "help_faq_translation",
        resourceId: id,
        reason: error.message,
        ...clientMetaFromRequest(request),
      });
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }

    await supabaseAdmin
      .from("help_faqs")
      .update({ updated_by: gate.actor.id ?? null })
      .eq("id", id);

    void recordSuccess({
      actor: gate.actor,
      action: "help.faq.update",
      module: "help",
      description: `FAQ ${locale} translation saved`,
      resourceType: "help_faq_translation",
      resourceId: row?.id,
      entityLabel: `${id}:${locale}`,
      beforeData: existing,
      afterData: row ?? undefined,
      ...clientMetaFromRequest(request),
    });

    return NextResponse.json({ ok: true, row });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Internal error" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string; locale: string }> },
) {
  const gate = await requireAdminPermission("help.manage", {
    request,
    auditModule: "help",
  });
  if (!gate.ok) return gate.response;

  try {
    const { id, locale: localeRaw } = await context.params;
    const locale = localeRaw.toLowerCase();
    if (!isHelpLocale(locale)) {
      return NextResponse.json(
        { ok: false, error: "locale must be en, hi, or gu." },
        { status: 400 },
      );
    }
    if (locale === "en") {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Cannot delete the English translation. Unpublish or edit it instead.",
        },
        { status: 400 },
      );
    }

    const { data: before } = await supabaseAdmin
      .from("help_faq_translations")
      .select("id, faq_id, locale, question, answer")
      .eq("faq_id", id)
      .eq("locale", locale)
      .maybeSingle();

    if (!before) {
      return NextResponse.json(
        { ok: false, error: "Translation not found." },
        { status: 404 },
      );
    }

    const { error } = await supabaseAdmin
      .from("help_faq_translations")
      .delete()
      .eq("id", before.id);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }

    void recordSuccess({
      actor: gate.actor,
      action: "help.faq.update",
      module: "help",
      description: `FAQ ${locale} translation deleted`,
      resourceType: "help_faq_translation",
      resourceId: before.id,
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
