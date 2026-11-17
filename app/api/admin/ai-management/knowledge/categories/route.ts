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
import { normalizeKnowledgeText } from "@/lib/ai-knowledge-admin";

/**
 * GET — list knowledge categories (help_ai.view)
 * PATCH — update category label/sort/active (help_ai.manage)
 */
export async function GET(request: Request) {
  const gate = await requireAdminPermission("help_ai.view", {
    request,
    auditModule: "help_ai",
  });
  if (!gate.ok) return gate.response;

  try {
    const { data, error } = await gate.supabase
      .from("skg_ai_knowledge_categories")
      .select("id, key, label, sort_order, is_active, updated_at")
      .order("sort_order", { ascending: true });

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          error: safeErrorMessage(error, "Failed to load categories."),
          migration_required: true,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      items: data ?? [],
      gemini_retrieval_wired: false,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: safeErrorMessage(error, "Failed to load categories."),
      },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  const gate = await requireAdminPermission("help_ai.manage", {
    request,
    auditModule: "help_ai",
  });
  if (!gate.ok) return gate.response;

  const auditBase = {
    actor: gate.actor,
    module: "help_ai",
    resourceType: "skg_ai_knowledge_category",
    ...clientMetaFromRequest(request),
  };

  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json(
        { ok: false, error: "Body must be an object." },
        { status: 400 },
      );
    }

    const id = String((body as { id?: unknown }).id ?? "");
    if (!isAdminUuid(id)) {
      return NextResponse.json(
        { ok: false, error: "Valid category id is required." },
        { status: 400 },
      );
    }

    const patch: Record<string, unknown> = {};
    if ("label" in (body as object)) {
      const label = normalizeKnowledgeText((body as { label?: unknown }).label);
      if (!label || label.length > 120) {
        return NextResponse.json(
          { ok: false, error: "label must be 1–120 characters." },
          { status: 400 },
        );
      }
      patch.label = label;
    }
    if ("sort_order" in (body as object)) {
      const n = Number((body as { sort_order?: unknown }).sort_order);
      if (!Number.isInteger(n)) {
        return NextResponse.json(
          { ok: false, error: "sort_order must be an integer." },
          { status: 400 },
        );
      }
      patch.sort_order = n;
    }
    if ("is_active" in (body as object)) {
      if (typeof (body as { is_active?: unknown }).is_active !== "boolean") {
        return NextResponse.json(
          { ok: false, error: "is_active must be a boolean." },
          { status: 400 },
        );
      }
      patch.is_active = (body as { is_active: boolean }).is_active;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json(
        { ok: false, error: "No category changes provided." },
        { status: 400 },
      );
    }

    const { data, error } = await gate.supabase
      .from("skg_ai_knowledge_categories")
      .update(patch)
      .eq("id", id)
      .select("id, key, label, sort_order, is_active, updated_at")
      .maybeSingle();

    if (error) {
      void recordFailure({
        ...auditBase,
        resourceId: id,
        action: "help_ai.knowledge.category.update",
        description: `Failed to update knowledge category ${id}`,
        reason: error.message,
      });
      return NextResponse.json(
        {
          ok: false,
          error: safeErrorMessage(error, "Failed to update category."),
        },
        { status: 500 },
      );
    }
    if (!data) {
      return NextResponse.json(
        { ok: false, error: "Category not found." },
        { status: 404 },
      );
    }

    void recordChange({
      ...auditBase,
      resourceId: id,
      action: "help_ai.knowledge.category.update",
      description: `Updated knowledge category ${data.key}`,
      changedFields: Object.keys(patch),
      afterData: data as Record<string, unknown>,
    });

    return NextResponse.json({ ok: true, item: data });
  } catch (error) {
    void recordFailure({
      ...auditBase,
      action: "help_ai.knowledge.category.update",
      description: "Failed to update knowledge category",
      reason: safeErrorMessage(error, "update_failed"),
    });
    return NextResponse.json(
      {
        ok: false,
        error: safeErrorMessage(error, "Failed to update category."),
      },
      { status: 500 },
    );
  }
}
