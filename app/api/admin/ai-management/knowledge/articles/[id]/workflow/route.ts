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
  GEMINI_KNOWLEDGE_RETRIEVAL,
  canApprove,
  canArchive,
  canPublish,
  canReject,
  canSubmitForReview,
  canUnpublish,
  hasEnglishTranslation,
  isAiKnowledgeStatus,
  knowledgeAuditSnapshot,
  normalizeKnowledgeText,
  type AiKnowledgeStatus,
} from "@/lib/ai-knowledge-admin";
import {
  KNOWLEDGE_ARTICLE_SELECT,
  appendKnowledgeVersion,
  asTranslations,
  mapArticleDetail,
} from "@/lib/ai-knowledge-store";

type Ctx = { params: Promise<{ id: string }> };

const ACTIONS = [
  "submit_review",
  "approve",
  "reject",
  "publish",
  "unpublish",
  "archive",
] as const;

type WorkflowAction = (typeof ACTIONS)[number];

function isWorkflowAction(value: string): value is WorkflowAction {
  return (ACTIONS as readonly string[]).includes(value);
}

/**
 * POST — knowledge workflow transitions (help_ai.manage)
 * Body: { action, reason? }
 * Publish requires approved + English translation.
 * Only published articles are Gemini-eligible (retrieval not wired yet).
 */
export async function POST(request: Request, context: Ctx) {
  const gate = await requireAdminPermission("help_ai.manage", {
    request,
    auditModule: "help_ai",
  });
  if (!gate.ok) return gate.response;

  const { id } = await context.params;
  if (!isAdminUuid(id)) {
    return NextResponse.json({ ok: false, error: "Invalid article id." }, { status: 400 });
  }

  const auditBase = {
    actor: gate.actor,
    module: "help_ai",
    resourceType: "skg_ai_knowledge_article",
    resourceId: id,
    ...clientMetaFromRequest(request),
  };

  try {
    const body = await request.json().catch(() => null);
    const actionRaw =
      body && typeof body === "object" && !Array.isArray(body)
        ? String((body as { action?: unknown }).action ?? "")
        : "";
    if (!isWorkflowAction(actionRaw)) {
      return NextResponse.json(
        {
          ok: false,
          error: `action must be one of: ${ACTIONS.join(", ")}.`,
        },
        { status: 400 },
      );
    }
    const action = actionRaw;
    const reason = normalizeKnowledgeText(
      body && typeof body === "object"
        ? (body as { reason?: unknown }).reason
        : "",
    );

    const { data: existing, error: loadError } = await gate.supabase
      .from("skg_ai_knowledge_articles")
      .select(KNOWLEDGE_ARTICLE_SELECT)
      .eq("id", id)
      .maybeSingle();

    if (loadError || !existing) {
      return NextResponse.json(
        {
          ok: false,
          error: loadError
            ? safeErrorMessage(loadError, "Failed to load article.")
            : "Article not found.",
        },
        { status: loadError ? 500 : 404 },
      );
    }

    const status = String(existing.status ?? "draft");
    if (!isAiKnowledgeStatus(status)) {
      return NextResponse.json(
        { ok: false, error: "Invalid article status." },
        { status: 500 },
      );
    }

    const translations = asTranslations(
      (existing as { skg_ai_knowledge_article_translations?: unknown })
        .skg_ai_knowledge_article_translations,
    );
    const locales = translations.map((t) => t.locale);
    const nextVersion = Number(existing.version ?? 1) + 1;
    const now = new Date().toISOString();

    let nextStatus: AiKnowledgeStatus = status;
    const auditAction = `help_ai.knowledge.${action}`;
    const changeReason = action;
    const patch: Record<string, unknown> = {
      version: nextVersion,
      updated_by: gate.actor.id,
    };

    if (action === "submit_review") {
      if (!canSubmitForReview(status)) {
        return NextResponse.json(
          { ok: false, error: "Only draft or rejected articles can be submitted for review." },
          { status: 400 },
        );
      }
      if (translations.length === 0) {
        return NextResponse.json(
          { ok: false, error: "Add at least one translation before submitting for review." },
          { status: 400 },
        );
      }
      nextStatus = "pending_review";
      patch.status = nextStatus;
      patch.rejection_reason = null;
    } else if (action === "approve") {
      if (!canApprove(status)) {
        return NextResponse.json(
          { ok: false, error: "Only pending_review articles can be approved." },
          { status: 400 },
        );
      }
      nextStatus = "approved";
      patch.status = nextStatus;
      patch.approved_at = now;
      patch.approved_by = gate.actor.id;
      patch.rejection_reason = null;
    } else if (action === "reject") {
      if (!canReject(status)) {
        return NextResponse.json(
          { ok: false, error: "Only pending_review articles can be rejected." },
          { status: 400 },
        );
      }
      if (!reason) {
        return NextResponse.json(
          { ok: false, error: "A rejection reason is required." },
          { status: 400 },
        );
      }
      nextStatus = "rejected";
      patch.status = nextStatus;
      patch.rejection_reason = reason.slice(0, 1000);
    } else if (action === "publish") {
      if (!canPublish(status)) {
        return NextResponse.json(
          {
            ok: false,
            error: "Only approved articles can be published. Approve before publish.",
          },
          { status: 400 },
        );
      }
      if (!hasEnglishTranslation(locales)) {
        return NextResponse.json(
          {
            ok: false,
            error: "English (en) translation is required before publishing.",
          },
          { status: 400 },
        );
      }
      nextStatus = "published";
      patch.status = nextStatus;
      patch.published_at = now;
      patch.published_by = gate.actor.id;
      if (!(existing as { approved_at?: string | null }).approved_at) {
        patch.approved_at = now;
        patch.approved_by = gate.actor.id;
      }
    } else if (action === "unpublish") {
      if (!canUnpublish(status)) {
        return NextResponse.json(
          { ok: false, error: "Only published articles can be unpublished." },
          { status: 400 },
        );
      }
      nextStatus = "approved";
      patch.status = nextStatus;
      patch.published_at = null;
      patch.published_by = null;
    } else if (action === "archive") {
      if (!canArchive(status)) {
        return NextResponse.json(
          { ok: false, error: "Article is already archived." },
          { status: 400 },
        );
      }
      nextStatus = "archived";
      patch.status = nextStatus;
      patch.archived_at = now;
      patch.archived_by = gate.actor.id;
      if (status === "published") {
        patch.published_at = null;
        patch.published_by = null;
      }
    }

    const { error: updateError } = await gate.supabase
      .from("skg_ai_knowledge_articles")
      .update(patch)
      .eq("id", id);

    if (updateError) {
      void recordFailure({
        ...auditBase,
        action: auditAction,
        description: `Failed knowledge workflow ${action} on ${id}`,
        reason: updateError.message,
      });
      return NextResponse.json(
        {
          ok: false,
          error: safeErrorMessage(updateError, "Workflow action failed."),
        },
        { status: 500 },
      );
    }

    await appendKnowledgeVersion(gate.supabase, {
      articleId: id,
      version: nextVersion,
      status: nextStatus,
      changeReason,
      changedBy: gate.actor.id,
      categoryId: String(existing.category_id),
      sortOrder: Number(existing.sort_order ?? 0),
      keywords: Array.isArray(existing.keywords)
        ? (existing.keywords as string[])
        : [],
      rejectionReason:
        typeof patch.rejection_reason === "string"
          ? patch.rejection_reason
          : null,
      translations: translations.map((t) => ({
        locale: t.locale,
        title: t.title,
        body: t.body,
      })),
    });

    const { data: full } = await gate.supabase
      .from("skg_ai_knowledge_articles")
      .select(KNOWLEDGE_ARTICLE_SELECT)
      .eq("id", id)
      .maybeSingle();

    const before = mapArticleDetail(existing as Record<string, unknown>);
    const after = full
      ? mapArticleDetail(full as Record<string, unknown>)
      : before;

    void recordChange({
      ...auditBase,
      action: auditAction,
      description: `Knowledge article ${action}: ${id}`,
      changedFields: ["status", "version"],
      beforeData: knowledgeAuditSnapshot(before),
      afterData: knowledgeAuditSnapshot(after),
    });

    return NextResponse.json({
      ok: true,
      action,
      item: after,
      gemini_retrieval: GEMINI_KNOWLEDGE_RETRIEVAL,
      gemini_eligible: after.status === "published",
    });
  } catch (error) {
    void recordFailure({
      ...auditBase,
      action: "help_ai.knowledge.update",
      description: `Knowledge workflow failed for ${id}`,
      reason: safeErrorMessage(error, "workflow_failed"),
    });
    return NextResponse.json(
      {
        ok: false,
        error: safeErrorMessage(error, "Workflow action failed."),
      },
      { status: 500 },
    );
  }
}
