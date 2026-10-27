import { NextResponse } from "next/server";

import { requireAdminPermission } from "@/lib/admin-api";
import { clientMetaFromRequest, recordFailure, recordSuccess } from "@/lib/admin-audit";

type Body = {
  overrideId?: string;
  reason?: string;
};

export async function POST(request: Request) {
  const gate = await requireAdminPermission("fare_overrides.manage", {
    request,
    auditModule: "fare_overrides",
  });
  if (!gate.ok) return gate.response;

  const body = (await request.json().catch(() => ({}))) as Body;
  const overrideId = typeof body.overrideId === "string" ? body.overrideId.trim() : "";
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(overrideId)) {
    return NextResponse.json(
      { ok: false, error: "overrideId is required." },
      { status: 400 },
    );
  }

  const { data: before } = await gate.supabase
    .from("user_fare_overrides")
    .select("user_id, status")
    .eq("id", overrideId)
    .maybeSingle();
  const relatedUserId =
    before && typeof (before as Record<string, unknown>).user_id === "string"
      ? ((before as Record<string, unknown>).user_id as string)
      : null;

  const { data, error } = await gate.supabase.rpc("revoke_user_fare_override", {
    p_override_id: overrideId,
    p_revoked_by: "admin",
    p_reason: reason || null,
  });

  const revokeReason = reason || null;

  if (error) {
    void recordFailure({
      actor: gate.actor,
      action: "user_fare_override_revoked",
      module: "fare_overrides",
      description: `Failed to revoke fare override ${overrideId}`,
      resourceType: "user_fare_override",
      resourceId: overrideId,
      relatedUserId,
      reason: error.message,
      metadata: { revokeReason },
      ...clientMetaFromRequest(request),
    });
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 400 },
    );
  }

  void recordSuccess({
    actor: gate.actor,
    action: "user_fare_override_revoked",
    module: "fare_overrides",
    description: `Fare override ${overrideId} revoked`,
    resourceType: "user_fare_override",
    resourceId: overrideId,
    relatedUserId,
    reason: revokeReason,
    beforeData: before ? { status: (before as Record<string, unknown>).status } : null,
    afterData: { status: "revoked" },
    ...clientMetaFromRequest(request),
  });

  return NextResponse.json({ ok: true, data });
}
