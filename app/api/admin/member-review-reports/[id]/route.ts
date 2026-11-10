import { requireAdminPermission } from "@/lib/admin-api";
import {
  clientMetaFromRequest,
  recordFailure,
  recordSuccess,
} from "@/lib/admin-audit";
import {
  isMemberReviewUuid,
  parseResolveReportStatus,
} from "@/lib/member-review-admin-input";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

const WRITE_ERROR = "Unable to resolve review report.";

/**
 * PATCH /api/admin/member-review-reports/[id]
 * Body: { status: "resolved" | "dismissed" }
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
      return NextResponse.json({ error: "Invalid report id." }, { status: 400 });
    }

    let json: unknown;
    try {
      json = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const nextStatus = parseResolveReportStatus(
      json && typeof json === "object" && !Array.isArray(json)
        ? (json as Record<string, unknown>).status
        : null,
    );
    if (!nextStatus) {
      return NextResponse.json(
        { error: "status must be resolved or dismissed." },
        { status: 400 },
      );
    }

    const { data: before } = await supabaseAdmin
      .from("member_review_reports")
      .select("id, status, review_id, reporter_user_id")
      .eq("id", id)
      .maybeSingle();

    if (!before) {
      return NextResponse.json({ error: "Report not found." }, { status: 404 });
    }

    const actorLabel =
      adminGate.actor.displayName ||
      adminGate.actor.username ||
      adminGate.actor.id ||
      "admin";

    const { data, error } = await supabaseAdmin
      .from("member_review_reports")
      .update({
        status: nextStatus,
        resolved_at: new Date().toISOString(),
        resolved_by: actorLabel,
      })
      .eq("id", id)
      .select(
        "id, review_id, reporter_user_id, reason, status, created_at, resolved_at, resolved_by",
      )
      .single();

    if (error) {
      void recordFailure({
        actor: adminGate.actor,
        action:
          nextStatus === "resolved"
            ? "member_review_report_resolved"
            : "member_review_report_dismissed",
        module: "reviews",
        description: `Failed to ${nextStatus} review report ${id}`,
        resourceType: "member_review_report",
        resourceId: id,
        reason: error.message,
        ...clientMetaFromRequest(request),
      });
      return NextResponse.json({ error: WRITE_ERROR }, { status: 400 });
    }

    void recordSuccess({
      actor: adminGate.actor,
      action:
        nextStatus === "resolved"
          ? "member_review_report_resolved"
          : "member_review_report_dismissed",
      module: "reviews",
      description: `Member review report ${id} marked ${nextStatus} by ${actorLabel}`,
      resourceType: "member_review_report",
      resourceId: id,
      changedFields: ["status", "resolved_at", "resolved_by"],
      beforeData: { status: before.status },
      afterData: { status: nextStatus, resolved_by: actorLabel },
      ...clientMetaFromRequest(request),
    });

    return NextResponse.json({ ok: true, report: data });
  } catch {
    return NextResponse.json({ error: WRITE_ERROR }, { status: 500 });
  }
}
