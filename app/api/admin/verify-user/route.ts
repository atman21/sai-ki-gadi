import { NextResponse } from "next/server";

import { requireAdminPermission, safeErrorMessage } from "@/lib/admin-api";
import { clientMetaFromRequest, writeAdminAuditLog } from "@/lib/admin-audit";

type VerifyPayload = {
  userId?: string;
};

export async function POST(request: Request) {
  const gate = await requireAdminPermission("members.approve", {
    request,
    auditModule: "members",
  });
  if (!gate.ok) return gate.response;

  const body = (await request.json().catch(() => ({}))) as VerifyPayload;
  const userId = body.userId?.trim() ?? "";
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: "Invalid request payload." },
      { status: 400 },
    );
  }

  const { data: before } = await gate.supabase
    .from("users")
    .select("id, verification_status, verified, first_name, last_name, phone")
    .eq("id", userId)
    .maybeSingle();

  if (!before) {
    return NextResponse.json(
      { ok: false, error: "Member not found." },
      { status: 404 },
    );
  }

  const nowIso = new Date().toISOString();
  const actorLabel = gate.actor.displayName || gate.actor.username || "admin";

  let { error } = await gate.supabase
    .from("users")
    .update({
      verified: true,
      verification_status: "approved",
      verification_rejection_reason: null,
      verification_reviewed_by: actorLabel,
      verification_reviewed_at: nowIso,
      verification_reviewed_by_admin_id: gate.actor.id,
    })
    .eq("id", userId);

  if (
    error &&
    (error.code === "42703" ||
      /verification_rejection_reason/i.test(error.message))
  ) {
    const fallback = await gate.supabase
      .from("users")
      .update({
        verified: true,
        verification_status: "approved",
        verification_reviewed_by: actorLabel,
        verification_reviewed_at: nowIso,
        verification_reviewed_by_admin_id: gate.actor.id,
      })
      .eq("id", userId);
    error = fallback.error;
  }

  if (error) {
    void writeAdminAuditLog({
      actor: gate.actor,
      action: "member_approve_failed",
      module: "members",
      description: `Failed to approve member ${userId}`,
      success: false,
      resourceType: "user",
      resourceId: userId,
      metadata: { error: error.message },
      ...clientMetaFromRequest(request),
    });
    return NextResponse.json(
      { ok: false, error: safeErrorMessage(error, "Approval failed.") },
      { status: 400 },
    );
  }

  const memberName = [before.first_name, before.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();

  const audit = await writeAdminAuditLog({
    actor: gate.actor,
    action: "member_approved",
    module: "members",
    description: `Member ${memberName || before.phone || userId} was approved by ${actorLabel}`,
    success: true,
    resourceType: "user",
    resourceId: userId,
    changedFields: [
      "verified",
      "verification_status",
      "verification_reviewed_by",
      "verification_reviewed_at",
    ],
    beforeData: {
      verified: before.verified,
      verification_status: before.verification_status,
    },
    afterData: {
      verified: true,
      verification_status: "approved",
      verification_reviewed_by: actorLabel,
      verification_reviewed_at: nowIso,
    },
    ...clientMetaFromRequest(request),
  });

  return NextResponse.json({
    ok: true,
    reviewedBy: actorLabel,
    reviewedAt: nowIso,
    auditEventId: audit.id ?? null,
  });
}
