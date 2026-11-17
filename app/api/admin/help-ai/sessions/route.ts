import { NextResponse } from "next/server";

import { requireAdminPermission } from "@/lib/admin-api";
import { supabaseAdmin } from "@/lib/supabase-admin";

const SESSION_SELECT = `
  id, user_id, status, language, lease_seconds, reserved_seconds, settled_seconds,
  lease_expires_at, started_at, ended_at, last_heartbeat_at, end_reason,
  device_id, created_at, updated_at
`;

export async function GET(request: Request) {
  const gate = await requireAdminPermission("help_ai.view", {
    request,
    auditModule: "help_ai",
  });
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const status = (url.searchParams.get("status") ?? "").trim();
  const userId = (url.searchParams.get("userId") ?? "").trim();
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
  const pageSize = Math.min(
    100,
    Math.max(1, Number(url.searchParams.get("pageSize") ?? "20") || 20),
  );
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabaseAdmin
    .from("skg_ai_voice_sessions")
    .select(SESSION_SELECT, { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (
    status &&
    ["reserved", "active", "ended", "expired", "failed"].includes(status)
  ) {
    query = query.eq("status", status);
  }
  if (userId) {
    query = query.eq("user_id", userId);
  }
  if (fromParam && !Number.isNaN(Date.parse(fromParam))) {
    query = query.gte("created_at", new Date(fromParam).toISOString());
  }
  if (toParam && !Number.isNaN(Date.parse(toParam))) {
    query = query.lte("created_at", new Date(toParam).toISOString());
  }

  const { data, error, count } = await query;
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const rows = data ?? [];
  const userIds = [...new Set(rows.map((r) => String(r.user_id)))];
  const labels: Record<string, string> = {};
  if (userIds.length > 0) {
    const { data: users } = await supabaseAdmin
      .from("users")
      .select("id, phone")
      .in("id", userIds);
    for (const u of users ?? []) {
      const mobile = u.phone ? String(u.phone) : "";
      labels[u.id] =
        mobile.length >= 4 ? `****${mobile.slice(-4)}` : u.id.slice(0, 8);
    }
  }

  // Never return gemini_resumption_handle (privacy / not in select).
  const enriched = rows.map((row) => ({
    ...row,
    user_display_ref: labels[row.user_id as string] ?? String(row.user_id).slice(0, 8),
  }));

  return NextResponse.json({
    ok: true,
    rows: enriched,
    page,
    pageSize,
    total: count ?? 0,
  });
}
