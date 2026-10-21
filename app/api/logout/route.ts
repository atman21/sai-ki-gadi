import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { ADMIN_SESSION_COOKIE } from "@/lib/admin-auth";
import { writeAdminAuditLog } from "@/lib/admin-audit";
import { resolveActorFromSession } from "@/lib/admin-rbac";
import { getAdminSessionPayload } from "@/lib/admin-session";

export async function POST() {
  const cookieStore = await cookies();
  const session = getAdminSessionPayload(cookieStore);
  if (session) {
    const actor = await resolveActorFromSession(session);
    void writeAdminAuditLog({
      actor,
      action: "logout",
      module: "auth",
      description: `Admin "${session.username}" signed out`,
      success: true,
    });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.delete(ADMIN_SESSION_COOKIE);
  return response;
}
