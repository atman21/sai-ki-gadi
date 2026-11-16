import { NextResponse } from "next/server";

import { requireAdminPermission, safeErrorMessage } from "@/lib/admin-api";
import { categoryLabel } from "@/lib/help-faq-admin";

/**
 * List Help FAQ categories (T29 help_faq_categories).
 * Permission: help.view
 */
export async function GET(request: Request) {
  const gate = await requireAdminPermission("help.view", {
    request,
    auditModule: "help",
  });
  if (!gate.ok) return gate.response;

  try {
    const { data, error } = await gate.supabase
      .from("help_faq_categories")
      .select("id, key, sort_order, is_active, updated_at")
      .order("sort_order", { ascending: true });

    if (error) {
      return NextResponse.json(
        { ok: false, error: safeErrorMessage(error, "Failed to load categories.") },
        { status: 500 },
      );
    }

    const items = (data ?? []).map((row) => ({
      id: row.id as string,
      key: row.key as string,
      label: categoryLabel(String(row.key)),
      sort_order: Number(row.sort_order ?? 0),
      is_active: row.is_active !== false,
      updated_at: row.updated_at as string | null,
    }));

    return NextResponse.json({ ok: true, items });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Failed to load categories." },
      { status: 500 },
    );
  }
}
