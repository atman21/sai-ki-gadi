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
    void writeAdminAuditLog({
      actor: gate.actor,
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

    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "Forbidden — insufficient permissions." },
        { status: 403 },
      ),
    };
  }

  return gate;
}

export function safeErrorMessage(error: unknown, fallback: string): string {
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string"
  ) {
    const message = (error as { message: string }).message;
    if (/permission denied|rls|jwt|service.role/i.test(message)) {
      return fallback;
    }
    return message;
  }
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
