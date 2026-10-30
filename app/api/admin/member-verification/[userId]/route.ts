import { NextResponse } from "next/server";

import { parseMemberVerificationDetail } from "@/lib/admin-ops-parse";
import { callAdminOpsFunction } from "@/lib/secure-admin-backend";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ userId: string }> },
) {
  const { userId } = await context.params;
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(userId)) {
    return NextResponse.json(
      { ok: false, error: "Member verification is unavailable." },
      { status: 400 },
    );
  }

  const result = await callAdminOpsFunction("admin-member-verification", {
    action: "detail",
    user_id: userId,
  });
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: result.status },
    );
  }

  const detail = parseMemberVerificationDetail(result.payload);
  if (!detail) {
    return NextResponse.json(
      { ok: false, error: "Member verification is unavailable." },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, detail });
}
