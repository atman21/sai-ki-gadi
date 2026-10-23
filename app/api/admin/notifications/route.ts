import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { requireAdminApi } from "@/lib/admin-api";
import { clientMetaFromRequest, recordFailure, recordSuccess } from "@/lib/admin-audit";
import { hasAdminSession } from "@/lib/admin-session";
import {
  serviceRoleConfigIssue,
  supabaseAdmin,
  usingServiceRole,
} from "@/lib/supabase-admin";

export type AdminNotificationRow = {
  id: string;
  type: string;
  title: string;
  message: string;
  user_id: string | null;
  is_read: boolean;
  created_at: string;
};

export async function GET() {
  const cookieStore = await cookies();
  if (!hasAdminSession(cookieStore)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  if (!usingServiceRole) {
    return NextResponse.json(
      {
        ok: false,
        error:
          serviceRoleConfigIssue() ??
          "Server-only SUPABASE_SERVICE_ROLE_KEY is required.",
      },
      { status: 503 },
    );
  }

  const { data, error } = await supabaseAdmin
    .from("admin_notifications")
    .select("id, type, title, message, user_id, is_read, created_at")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 400 },
    );
  }

  const notifications = (data ?? []) as AdminNotificationRow[];
  const unreadCount = notifications.filter((n) => !n.is_read).length;

  return NextResponse.json({
    ok: true,
    notifications,
    unreadCount,
  });
}

type PatchBody = {
  ids?: string[];
  markAllRead?: boolean;
};

export async function PATCH(request: Request) {
  const gate = await requireAdminApi();
  if (!gate.ok) return gate.response;

  const body = (await request.json().catch(() => ({}))) as PatchBody;

  let query = gate.supabase
    .from("admin_notifications")
    .update({ is_read: true })
    .eq("is_read", false);

  if (body.markAllRead) {
    // all unread
  } else if (Array.isArray(body.ids) && body.ids.length > 0) {
    query = query.in("id", body.ids);
  } else {
    return NextResponse.json(
      { ok: false, error: "Provide ids or markAllRead." },
      { status: 400 },
    );
  }

  const { error } = await query;
  const idCount = Array.isArray(body.ids) ? body.ids.length : 0;
  if (error) {
    void recordFailure({
      actor: gate.actor,
      action: "admin_notifications_marked_read",
      module: "notifications",
      description: body.markAllRead
        ? "Failed to mark all admin notifications as read"
        : `Failed to mark ${idCount} admin notification(s) as read`,
      resourceType: "admin_notification",
      reason: error.message,
      metadata: { markAllRead: Boolean(body.markAllRead), idCount },
      ...clientMetaFromRequest(request),
    });
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 400 },
    );
  }

  void recordSuccess({
    actor: gate.actor,
    action: "admin_notifications_marked_read",
    module: "notifications",
    description: body.markAllRead
      ? "Marked all admin notifications as read"
      : `Marked ${idCount} admin notification(s) as read`,
    resourceType: "admin_notification",
    resourceId: !body.markAllRead && idCount === 1 ? body.ids?.[0] : undefined,
    metadata: { markAllRead: Boolean(body.markAllRead), idCount },
    ...clientMetaFromRequest(request),
  });

  return NextResponse.json({ ok: true });
}
