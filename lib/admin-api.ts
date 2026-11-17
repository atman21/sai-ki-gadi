import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { writeAdminAuditLog } from "@/lib/admin-audit";
import type { AdminPermission } from "@/lib/admin-permissions";
import {
  actorHasPermission,
  resolveActorFromSession,
  type AdminActor,
} from "@/lib/admin-rbac";
import { getAdminSessionPayload, hasAdminSession } from "@/lib/admin-session";
import {
  serviceRoleConfigIssue,
  supabaseAdmin,
  usingServiceRole,
} from "@/lib/supabase-admin";

export type AdminApiOk = {
  ok: true;
  supabase: typeof supabaseAdmin;
  actor: AdminActor;
};

export type AdminApiDenied = {
  ok: false;
  response: NextResponse;
};

/**
 * Shared gate for all `/api/admin/*` routes (except login).
 * Requires a valid admin session cookie, resolves actor, and service role.
 */
export async function requireAdminApi(): Promise<AdminApiOk | AdminApiDenied> {
  const cookieStore = await cookies();
  if (!hasAdminSession(cookieStore)) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 },
      ),
    };
  }

  if (!usingServiceRole) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          ok: false,
          error:
            serviceRoleConfigIssue() ??
            "Server-only SUPABASE_SERVICE_ROLE_KEY is required.",
        },
        { status: 503 },
      ),
    };
  }

  const session = getAdminSessionPayload(cookieStore);
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 },
      ),
    };
  }

  const actor = await resolveActorFromSession(session);
  if (!actor || !actor.isActive) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          ok: false,
          error: "Unauthorized — account disabled or session invalid.",
        },
        { status: 401 },
      ),
    };
  }

  return { ok: true, supabase: supabaseAdmin, actor };
}

/**
 * 403 + permission_denied audit for an already-authenticated actor.
 * Use when a route needs field-level permission checks after requireAdminApi.
 */
export function permissionDeniedResponse(
  actor: AdminActor,
  permission: AdminPermission,
  opts?: { request?: Request; auditModule?: string },
): NextResponse {
  void writeAdminAuditLog({
    actor,
    action: "permission_denied",
    module: opts?.auditModule ?? "security",
    description: `Permission denied for ${permission}`,
    success: false,
    metadata: { permission },
    ipAddress: opts?.request
      ? opts.request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        undefined
      : undefined,
    userAgent: opts?.request?.headers.get("user-agent") || undefined,
  });

  return NextResponse.json(
    { ok: false, error: "Forbidden — insufficient permissions." },
    { status: 403 },
  );
}

/**
 * Require authenticated admin + a specific permission.
 * Super Admin always passes. Denied attempts are audited (best-effort).
 */
export async function requireAdminPermission(
  permission: AdminPermission,
  opts?: { request?: Request; auditModule?: string },
): Promise<AdminApiOk | AdminApiDenied> {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate;

  if (!actorHasPermission(gate.actor, permission)) {
    return {
      ok: false,
      response: permissionDeniedResponse(gate.actor, permission, opts),
    };
  }

  return gate;
}

/**
 * Client-safe error text. Never returns raw database/internal messages.
 * Callers should keep diagnostics in audit logs (reason field), not responses.
 * Expected validation messages must be returned explicitly by the route.
 */
export function safeErrorMessage(_error: unknown, fallback: string): string {
  return fallback;
}

export function unauthorizedResponse() {
  return NextResponse.json(
    { ok: false, error: "Unauthorized" },
    { status: 401 },
  );
}

export function forbiddenResponse(message = "Forbidden") {
  return NextResponse.json({ ok: false, error: message }, { status: 403 });
}
