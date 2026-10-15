import { NextResponse } from "next/server";

import { requireAdminApi, safeErrorMessage } from "@/lib/admin-api";

/**
 * Runs the secure service-role RPC `admin_expire_memberships`.
 * Does not change account ON/OFF status — only membership fields / history.
 */
export async function POST() {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const { data, error } = await gate.supabase.rpc("admin_expire_memberships");

  if (error) {
    return NextResponse.json(
      {
        ok: false,
        error: safeErrorMessage(error, "Unable to expire memberships."),
      },
      { status: 500 },
    );
  }

  const expiredCount = typeof data === "number" ? data : Number(data ?? 0);

  return NextResponse.json({
    ok: true,
    expiredCount: Number.isFinite(expiredCount) ? expiredCount : 0,
  });
}
