import { NextResponse } from "next/server";

import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_MAX_AGE_SECONDS,
  createAdminSessionValue,
} from "@/lib/admin-auth";
import { writeAdminAuditLog, clientMetaFromRequest } from "@/lib/admin-audit";
import { authenticateAdminLogin } from "@/lib/admin-rbac";
import {
  checkLoginRateLimit,
  clearLoginRateLimit,
} from "@/lib/admin-login-rate-limit";

type LoginRequest = {
  username?: string;
  password?: string;
};

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as LoginRequest;
  const username = body.username?.trim() ?? "";
  const password = body.password ?? "";
  const meta = clientMetaFromRequest(request);
  const rateKey = `${meta.ipAddress ?? "unknown"}:${username.toLowerCase()}`;

  const rate = checkLoginRateLimit(rateKey);
  if (!rate.allowed) {
    void writeAdminAuditLog({
      actor: null,
      action: "login_rate_limited",
      module: "auth",
      description: `Login rate-limited for username "${username}"`,
      success: false,
      metadata: { username },
      ...meta,
    });
    return NextResponse.json(
      {
        ok: false,
        error: `Too many login attempts. Try again in ${rate.retryAfterSec ?? 900} seconds.`,
      },
      { status: 429 },
    );
  }

  const result = await authenticateAdminLogin(username, password);
  if (!result.ok) {
    void writeAdminAuditLog({
      actor: null,
      action: "login_failed",
      module: "auth",
      description: `Failed admin login for username "${username}"`,
      success: false,
      metadata: { username },
      ...meta,
    });
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: 401 },
    );
  }

  clearLoginRateLimit(rateKey);

  void writeAdminAuditLog({
    actor: result.actor,
    action: "login_success",
    module: "auth",
    description: `Admin "${result.actor.username}" signed in`,
    success: true,
    ...meta,
  });

  const response = NextResponse.json({
    ok: true,
    user: {
      username: result.actor.username,
      displayName: result.actor.displayName,
      isSuperAdmin: result.actor.isSuperAdmin,
    },
  });
  response.cookies.set(
    ADMIN_SESSION_COOKIE,
    createAdminSessionValue({
      adminId: result.sessionFields.adminId,
      username: result.sessionFields.username,
      displayName: result.sessionFields.displayName,
      isSuperAdmin: result.sessionFields.isSuperAdmin,
    }),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: ADMIN_SESSION_MAX_AGE_SECONDS,
    },
  );
  return response;
}
