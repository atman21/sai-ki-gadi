import { NextResponse } from "next/server";

import { requireAdminPermission } from "@/lib/admin-api";
import {
  clientMetaFromRequest,
  recordFailure,
  recordSuccess,
} from "@/lib/admin-audit";
import {
  normalizeCategoryKey,
  parseBool,
  parseSortOrder,
} from "@/lib/help-center";
import { supabaseAdmin } from "@/lib/supabase-admin";

const CATEGORY_SELECT =
  "id, key, sort_order, is_active, created_at, updated_at";

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
      .from("help_faq_categories")
      .select(CATEGORY_SELECT)
      .eq("id", id)
      .maybeSingle();

    if (!before) {
      return NextResponse.json(
        { ok: false, error: "Category not found." },
        { status: 404 },
      );
    }

    const patch: Record<string, unknown> = {};

    if (body?.key !== undefined) {
      const key = normalizeCategoryKey(body.key);
      if (!key.ok) {
        return NextResponse.json({ ok: false, error: key.error }, { status: 400 });
      }
      patch.key = key.value;
    }
    if (body?.sort_order !== undefined) {
      const sort = parseSortOrder(body.sort_order, before.sort_order);
      if (!sort.ok) {
        return NextResponse.json({ ok: false, error: sort.error }, { status: 400 });
      }
      patch.sort_order = sort.value;
    }
    if (body?.is_active !== undefined) {
      patch.is_active = parseBool(body.is_active, before.is_active);
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { ok: false, error: "No valid fields to update." },
        { status: 400 },
      );
    }

    const { data, error } = await supabaseAdmin
      .from("help_faq_categories")
      .update(patch)
      .eq("id", id)
      .select(CATEGORY_SELECT)
      .single();

    if (error) {
      const isDup = error.code === "23505" || /duplicate|unique/i.test(error.message);
      void recordFailure({
        actor: gate.actor,
        action: "help_category_updated",
        module: "help",
        description: `Failed to update FAQ category ${before.key}`,
        resourceType: "help_faq_category",
        resourceId: id,
        entityLabel: before.key,
        reason: error.message,
        ...clientMetaFromRequest(request),
      });
      return NextResponse.json(
        {
          ok: false,
          error: isDup ? "A category with this key already exists." : error.message,
        },
        { status: isDup ? 409 : 400 },
      );
    }

    void recordSuccess({
      actor: gate.actor,
      action: "help_category_updated",
      module: "help",
      description: `FAQ category ${data?.key ?? before.key} updated`,
      resourceType: "help_faq_category",
      resourceId: id,
      entityLabel: data?.key ?? before.key,
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
      .from("help_faq_categories")
      .select(CATEGORY_SELECT)
      .eq("id", id)
      .maybeSingle();

    if (!before) {
      return NextResponse.json(
        { ok: false, error: "Category not found." },
        { status: 404 },
      );
    }

    const { count } = await supabaseAdmin
      .from("help_faqs")
      .select("id", { count: "exact", head: true })
      .eq("category_id", id);

    if ((count ?? 0) > 0) {
      return NextResponse.json(
        {
          ok: false,
          error: `Cannot delete category — ${count} FAQ(s) still reference it. Reassign or delete those FAQs first.`,
        },
        { status: 409 },
      );
    }

    const { error } = await supabaseAdmin
      .from("help_faq_categories")
      .delete()
      .eq("id", id);

    if (error) {
      void recordFailure({
        actor: gate.actor,
        action: "help_category_deleted",
        module: "help",
        description: `Failed to delete FAQ category ${before.key}`,
        resourceType: "help_faq_category",
        resourceId: id,
        entityLabel: before.key,
        reason: error.message,
        ...clientMetaFromRequest(request),
      });
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }

    void recordSuccess({
      actor: gate.actor,
      action: "help_category_deleted",
      module: "help",
      description: `FAQ category ${before.key} deleted`,
      resourceType: "help_faq_category",
      resourceId: id,
      entityLabel: before.key,
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
