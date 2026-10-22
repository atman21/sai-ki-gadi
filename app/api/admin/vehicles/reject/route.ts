import { NextResponse } from "next/server";

import { requireAdminPermission, safeErrorMessage } from "@/lib/admin-api";
import { writeAdminAuditLog, clientMetaFromRequest } from "@/lib/admin-audit";

type Body = {
  vehicleId?: string;
  reason?: string;
};

export async function POST(request: Request) {
  const gate = await requireAdminPermission("vehicles.reject", {
    request,
    auditModule: "vehicles",
  });
  if (!gate.ok) return gate.response;

  const body = (await request.json().catch(() => ({}))) as Body;
  const vehicleId = body.vehicleId?.trim() ?? "";
  const reason = body.reason?.trim() ?? "";
  if (!vehicleId) {
    return NextResponse.json(
      { ok: false, error: "Invalid request payload." },
      { status: 400 },
    );
  }
  if (!reason) {
    return NextResponse.json(
      { ok: false, error: "Rejection reason is required." },
      { status: 400 },
    );
  }

  const actorLabel =
    gate.actor.displayName || gate.actor.username || "admin";
  const nowIso = new Date().toISOString();

  const { error } = await gate.supabase
    .from("user_vehicles")
    .update({
      verification_status: "rejected",
      rejection_reason: reason,
      reviewed_at: nowIso,
      reviewed_by: actorLabel,
    })
    .eq("id", vehicleId)
    .eq("verification_status", "pending");

  if (error) {
    return NextResponse.json(
      { ok: false, error: safeErrorMessage(error, "Rejection failed.") },
      { status: 400 },
    );
  }

  void writeAdminAuditLog({
    actor: gate.actor,
    action: "vehicle_rejected",
    module: "vehicles",
    description: `Vehicle ${vehicleId} rejected by ${actorLabel}`,
    success: true,
    resourceType: "user_vehicle",
    resourceId: vehicleId,
    afterData: {
      verification_status: "rejected",
      rejection_reason: reason,
      reviewed_by: actorLabel,
    },
    ...clientMetaFromRequest(request),
  });

  return NextResponse.json({ ok: true, reviewedBy: actorLabel });
}
