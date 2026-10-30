import { NextResponse } from "next/server";

import {
  parseNotificationList,
  parseUnreadCount,
} from "@/lib/admin-ops-parse";
import { callAdminOpsFunction } from "@/lib/secure-admin-backend";

export const dynamic = "force-dynamic";

function opsError(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function GET() {
  const [listResult, countResult] = await Promise.all([
    callAdminOpsFunction("admin-notifications", { action: "list", limit: 50 }),
    callAdminOpsFunction("admin-notifications", { action: "unread_count" }),
  ]);

  if (!listResult.ok) return opsError(listResult.status, listResult.error);

  const notifications = parseNotificationList(listResult.payload);
  const derived = notifications.filter((item) => !item.is_read).length;
  const unreadCount = countResult.ok
    ? parseUnreadCount(countResult.payload, derived)
    : derived;

  return NextResponse.json({
    ok: true,
    notifications,
    unreadCount,
  });
}

type MutationBody = {
  ids?: unknown;
  id?: unknown;
  markAllRead?: unknown;
};

export async function PATCH(request: Request) {
  const body = (await request.json().catch(() => ({}))) as MutationBody;
  const markAll = body.markAllRead === true;
  const ids = Array.isArray(body.ids)
    ? body.ids.filter((id): id is string => typeof id === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(id))
    : [];

  if (!markAll && ids.length === 0) {
    return opsError(400, "Provide ids or markAllRead.");
  }

  const result = await callAdminOpsFunction("admin-notifications", {
    action: "mark_read",
    ...(markAll ? { mark_all: true } : { ids }),
  });
  if (!result.ok) return opsError(result.status, result.error);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const body = (await request.json().catch(() => ({}))) as MutationBody;
  const id = typeof body.id === "string" ? body.id : "";
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) {
    return opsError(400, "A notification id is required.");
  }

  const result = await callAdminOpsFunction("admin-notifications", {
    action: "delete",
    id,
  });
  if (!result.ok) return opsError(result.status, result.error);
  return NextResponse.json({ ok: true });
}
