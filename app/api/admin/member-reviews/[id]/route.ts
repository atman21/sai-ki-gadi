import { requireAdminPermission } from "@/lib/admin-api";
import {
  clientMetaFromRequest,
  recordFailure,
  recordSuccess,
} from "@/lib/admin-audit";
import {
  isMemberReviewUuid,
  parseModerateAction,
  statusAfterModerate,
} from "@/lib/member-review-admin-input";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

const WRITE_ERROR = "Unable to moderate member review.";

/**
 * PATCH /api/admin/member-reviews/[id]
 * Body: { action: "hide" | "unhide" | "remove" }
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const adminGate = await requireAdminPermission("reviews.moderate", {
    request,
    auditModule: "reviews",
  });
  if (!adminGate.ok) return adminGate.response;

  try {
    const { id } = await params;
    if (!isMemberReviewUuid(id)) {
      return NextResponse.json({ error: "Invalid review id." }, { status: 400 });
    }

    let json: unknown;
    try {
      json = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const action = parseModerateAction(
      json && typeof json === "object" && !Array.isArray(json)
        ? (json as Record<string, unknown>).action
        : null,
    );
    if (!action) {
      return NextResponse.json(
        { error: "action must be hide, unhide, or remove." },
        { status: 400 },
      );
    }

    const { data: before } = await supabaseAdmin
      .from("member_reviews")
      .select("id, status, reviewer_user_id, subject_user_id, rating")
      .eq("id", id)
      .maybeSingle();

    if (!before) {
      return NextResponse.json({ error: "Review not found." }, { status: 404 });
    }

    if (action === "unhide" && before.status === "removed") {
      return NextResponse.json(
        { error: "Removed reviews cannot be unhidden. Member may submit a new review." },
        { status: 400 },
      );
    }

    if (action === "hide" && before.status !== "published") {
      return NextResponse.json(
        { error: "Only published reviews can be hidden." },
        { status: 400 },
      );
    }

    if (action === "remove" && before.status === "removed") {
      return NextResponse.json(
        { error: "Review is already removed." },
        { status: 400 },
      );
    }

    const nextStatus = statusAfterModerate(action);
    const actorLabel =
      adminGate.actor.displayName ||
      adminGate.actor.username ||
      adminGate.actor.id ||
      "admin";

    const { data, error } = await supabaseAdmin
      .from("member_reviews")
      .update({
        status: nextStatus,
        moderated_at: new Date().toISOString(),
        moderated_by: actorLabel,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select(
        "id, reviewer_user_id, subject_user_id, rating, review_text, status, created_at, updated_at, moderated_at, moderated_by",
      )
      .single();

    if (error) {
      void recordFailure({
        actor: adminGate.actor,
        action:
          action === "hide"
            ? "member_review_hidden"
            : action === "unhide"
              ? "member_review_unhidden"
              : "member_review_removed",
        module: "reviews",
        description: `Failed to ${action} member review ${id}`,
        resourceType: "member_review",
        resourceId: id,
        relatedUserId: before.subject_user_id,
        reason: error.message,
        ...clientMetaFromRequest(request),
      });
      return NextResponse.json({ error: WRITE_ERROR }, { status: 400 });
    }

    const auditAction =
      action === "hide"
        ? "member_review_hidden"
        : action === "unhide"
          ? "member_review_unhidden"
          : "member_review_removed";

    void recordSuccess({
      actor: adminGate.actor,
      action: auditAction,
      module: "reviews",
      description: `Member review ${id} ${action} by ${actorLabel}`,
      resourceType: "member_review",
      resourceId: id,
      relatedUserId: before.subject_user_id,
      changedFields: ["status", "moderated_at", "moderated_by"],
      beforeData: { status: before.status },
      afterData: { status: nextStatus, moderated_by: actorLabel },
      ...clientMetaFromRequest(request),
    });

    return NextResponse.json({ ok: true, review: data });
  } catch {
    return NextResponse.json({ error: WRITE_ERROR }, { status: 500 });
  }
}
