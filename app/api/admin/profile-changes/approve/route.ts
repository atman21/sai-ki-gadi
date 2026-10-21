import { NextResponse } from "next/server";

import { requireAdminPermission, safeErrorMessage } from "@/lib/admin-api";
import { writeAdminAuditLog, clientMetaFromRequest } from "@/lib/admin-audit";

type Body = {
  requestId?: string;
};

export async function POST(request: Request) {
  const gate = await requireAdminPermission("profile_changes.approve", {
    request,
    auditModule: "profile_changes",
  });
  if (!gate.ok) return gate.response;

  const body = (await request.json().catch(() => ({}))) as Body;
  const requestId = body.requestId?.trim() ?? "";
  if (!requestId) {
    return NextResponse.json(
      { ok: false, error: "Invalid request payload." },
      { status: 400 },
    );
  }

  const actorLabel =
    gate.actor.displayName || gate.actor.username || "admin";

  const { error } = await gate.supabase.rpc("approve_profile_change_request", {
    p_request_id: requestId,
    p_reviewed_by: actorLabel,
  });

  if (error) {
    return NextResponse.json(
      { ok: false, error: safeErrorMessage(error, "Approval failed.") },
      { status: 400 },
    );
  }

  void writeAdminAuditLog({
    actor: gate.actor,
    action: "profile_change_approved",
    module: "profile_changes",
    description: `Profile change request ${requestId} approved by ${actorLabel}`,
    success: true,
    resourceType: "profile_change_request",
    resourceId: requestId,
    ...clientMetaFromRequest(request),
  });

  return NextResponse.json({ ok: true, reviewedBy: actorLabel });
}
