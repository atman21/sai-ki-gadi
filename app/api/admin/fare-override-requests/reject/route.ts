import { NextResponse } from "next/server";

import { requireAdminPermission } from "@/lib/admin-api";
import { writeAdminAuditLog, clientMetaFromRequest } from "@/lib/admin-audit";

type Body = {
  requestId?: string;
  rejectionReason?: string;
};

export async function POST(request: Request) {
  const gate = await requireAdminPermission("fare_overrides.manage", {
    request,
    auditModule: "fare_overrides",
  });
  if (!gate.ok) return gate.response;

  const body = (await request.json().catch(() => ({}))) as Body;
  const requestId = body.requestId?.trim() ?? "";
  if (!requestId) {
    return NextResponse.json(
      { ok: false, error: "requestId is required." },
      { status: 400 },
    );
  }

  const actorLabel =
    gate.actor.displayName || gate.actor.username || "admin";

  const { data, error } = await gate.supabase.rpc(
    "reject_fare_override_request",
    {
      p_request_id: requestId,
      p_reviewed_by: actorLabel,
      p_rejection_reason: body.rejectionReason?.trim() || null,
    },
  );

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 400 },
    );
  }

  void writeAdminAuditLog({
    actor: gate.actor,
    action: "fare_override_rejected",
    module: "fare_overrides",
    description: `Fare override request ${requestId} rejected by ${actorLabel}`,
    success: true,
    resourceType: "fare_override_request",
    resourceId: requestId,
    afterData: { rejectionReason: body.rejectionReason?.trim() || null },
    ...clientMetaFromRequest(request),
  });

  return NextResponse.json({ ok: true, data, reviewedBy: actorLabel });
}
