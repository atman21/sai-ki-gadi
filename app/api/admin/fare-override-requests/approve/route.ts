import { NextResponse } from "next/server";

import { requireAdminPermission } from "@/lib/admin-api";
import { writeAdminAuditLog, clientMetaFromRequest } from "@/lib/admin-audit";

type Body = {
  requestId?: string;
  allowedMinFare?: number | string;
  permanent?: boolean;
  expiresAt?: string | null;
  durationDays?: number | null;
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

  const fareRaw = body.allowedMinFare;
  const allowedMinFare =
    typeof fareRaw === "number" ? fareRaw : Number(String(fareRaw ?? "").trim());
  if (!Number.isFinite(allowedMinFare) || allowedMinFare <= 0) {
    return NextResponse.json(
      { ok: false, error: "Allowed minimum fare must be greater than 0." },
      { status: 400 },
    );
  }

  const permanent = body.permanent !== false;
  let expiresAt: string | null = null;

  if (!permanent) {
    if (body.expiresAt) {
      const d = new Date(body.expiresAt);
      if (!Number.isFinite(d.getTime()) || d.getTime() <= Date.now()) {
        return NextResponse.json(
          { ok: false, error: "Expiry must be a future date." },
          { status: 400 },
        );
      }
      expiresAt = d.toISOString();
    } else if (
      body.durationDays &&
      [7, 30, 60].includes(Number(body.durationDays))
    ) {
      const d = new Date();
      d.setDate(d.getDate() + Number(body.durationDays));
      expiresAt = d.toISOString();
    } else {
      return NextResponse.json(
        {
          ok: false,
          error: "Temporary override requires 7/30/60 days or a custom expiry.",
        },
        { status: 400 },
      );
    }
  }

  const actorLabel =
    gate.actor.displayName || gate.actor.username || "admin";

  const { data, error } = await gate.supabase.rpc(
    "approve_fare_override_request",
    {
      p_request_id: requestId,
      p_allowed_min_fare: allowedMinFare,
      p_reviewed_by: actorLabel,
      p_expires_at: expiresAt,
      p_permanent: permanent,
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
    action: "fare_override_approved",
    module: "fare_overrides",
    description: `Fare override request ${requestId} approved by ${actorLabel}`,
    success: true,
    resourceType: "fare_override_request",
    resourceId: requestId,
    afterData: { allowedMinFare, permanent, expiresAt },
    ...clientMetaFromRequest(request),
  });

  return NextResponse.json({ ok: true, data, reviewedBy: actorLabel });
}
