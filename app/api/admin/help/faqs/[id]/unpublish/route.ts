import { NextResponse } from "next/server";

import { requireAdminPermission } from "@/lib/admin-api";
import {
  clientMetaFromRequest,
  recordFailure,
  recordSuccess,
} from "@/lib/admin-audit";
import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * Unpublish maps to status=draft (schema only allows draft|published).
 * Mobile RLS only returns status=published + active category.
 */
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

    const { data: before } = await supabaseAdmin
      .from("help_faqs")
      .select("id, status, published_at")
      .eq("id", id)
      .maybeSingle();

    if (!before) {
      return NextResponse.json({ ok: false, error: "FAQ not found." }, { status: 404 });
    }

    const { data, error } = await supabaseAdmin
      .from("help_faqs")
      .update({
        status: "draft",
        published_at: null,
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
        action: "help.faq.unpublish",
        module: "help",
        description: "Failed to unpublish FAQ",
        resourceType: "help_faq",
        resourceId: id,
        reason: error.message,
        ...clientMetaFromRequest(request),
      });
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }

    void recordSuccess({
      actor: gate.actor,
      action: "help.faq.unpublish",
      module: "help",
      description: "FAQ unpublished (set to draft)",
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
