import { NextResponse } from "next/server";

import { requireAdminApi, safeErrorMessage } from "@/lib/admin-api";
import { clientMetaFromRequest, recordFailure, recordSuccess } from "@/lib/admin-audit";

/**
 * Runs the secure service-role RPC `admin_expire_memberships`.
 * Does not change account ON/OFF status — only membership fields / history.
 */
export async function POST(request: Request) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const { data, error } = await gate.supabase.rpc("admin_expire_memberships");

  if (error) {
    await recordFailure({
      actor: gate.actor,
      action: "memberships_expired",
      module: "members",
      description: "Bulk membership expiry failed",
      resourceType: "membership",
      reason: safeErrorMessage(error, "Unable to expire memberships."),
      ...clientMetaFromRequest(request),
    });
    return NextResponse.json(
      {
        ok: false,
        error: safeErrorMessage(error, "Unable to expire memberships."),
      },
      { status: 500 },
    );
  }

  const expiredCount = typeof data === "number" ? data : Number(data ?? 0);

  await recordSuccess({
    actor: gate.actor,
    action: "memberships_expired",
    module: "members",
    description: `Expired ${Number.isFinite(expiredCount) ? expiredCount : 0} membership(s)`,
    resourceType: "membership",
    metadata: { expiredCount: Number.isFinite(expiredCount) ? expiredCount : 0 },
    ...clientMetaFromRequest(request),
  });

  return NextResponse.json({
    ok: true,
    expiredCount: Number.isFinite(expiredCount) ? expiredCount : 0,
  });
}
