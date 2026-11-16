import { NextResponse } from "next/server";

import {
  requireAdminPermission,
  safeErrorMessage,
} from "@/lib/admin-api";
import { isAdminUuid } from "@/lib/admin-uuid";
import { GEMINI_KNOWLEDGE_RETRIEVAL } from "@/lib/ai-knowledge-admin";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET — article version history (help_ai.view)
 * Returns frozen snapshots for Admin inspection (authenticated Admin only).
 */
export async function GET(request: Request, context: Ctx) {
  const gate = await requireAdminPermission("help_ai.view", {
    request,
    auditModule: "help_ai",
  });
  if (!gate.ok) return gate.response;

  const { id } = await context.params;
  if (!isAdminUuid(id)) {
    return NextResponse.json({ ok: false, error: "Invalid article id." }, { status: 400 });
  }

  try {
    const { data, error } = await gate.supabase
      .from("skg_ai_knowledge_article_versions")
      .select(
        `id, article_id, version, status, change_reason, changed_by, created_at,
         category_id, sort_order, keywords, rejection_reason, translations_json`,
      )
      .eq("article_id", id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          error: safeErrorMessage(error, "Failed to load versions."),
        },
        { status: 500 },
      );
    }

    const versions = (data ?? []).map((row) => {
      const translations = Array.isArray(row.translations_json)
        ? row.translations_json
        : [];
      return {
        id: row.id,
        version: row.version,
        status: row.status,
        change_reason: row.change_reason,
        changed_by: row.changed_by,
        created_at: row.created_at,
        category_id: row.category_id,
        keywords: row.keywords ?? [],
        rejection_reason: row.rejection_reason,
        locales: translations
          .map((t: { locale?: string }) => String(t?.locale ?? ""))
          .filter(Boolean),
        translations,
      };
    });

    return NextResponse.json({
      ok: true,
      article_id: id,
      versions,
      gemini_retrieval: GEMINI_KNOWLEDGE_RETRIEVAL,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: safeErrorMessage(error, "Failed to load versions."),
      },
      { status: 500 },
    );
  }
}
