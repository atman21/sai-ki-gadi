import { NextResponse } from "next/server";

import { requireAdminPermission } from "@/lib/admin-api";
import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * Database-backed voice analytics.
 * Settled usage = sum(settled_seconds). Reserved time is reported separately
 * and is never counted as settled usage.
 */
export async function GET(request: Request) {
  const gate = await requireAdminPermission("help_ai.view", {
    request,
    auditModule: "help_ai",
  });
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");

  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fromIso = fromParam
    ? new Date(fromParam).toISOString()
    : defaultFrom.toISOString();
  const toIso = toParam ? new Date(toParam).toISOString() : now.toISOString();

  if (Number.isNaN(Date.parse(fromIso)) || Number.isNaN(Date.parse(toIso))) {
    return NextResponse.json(
      { ok: false, error: "Invalid from/to date." },
      { status: 400 },
    );
  }

  const { data: settings } = await supabaseAdmin
    .from("skg_ai_settings")
    .select("weekly_allowance_seconds, max_session_seconds, voice_enabled, emergency_disabled")
    .eq("id", 1)
    .maybeSingle();

  const weeklyAllowance = settings?.weekly_allowance_seconds ?? 600;

  // All-time / filtered session rows (cap for safety; analytics aggregates in memory).
  let sessionQuery = supabaseAdmin
    .from("skg_ai_voice_sessions")
    .select(
      "id, user_id, status, reserved_seconds, settled_seconds, started_at, ended_at, created_at, end_reason, language",
    )
    .gte("created_at", fromIso)
    .lte("created_at", toIso)
    .order("created_at", { ascending: false })
    .limit(5000);

  const { data: sessions, error } = await sessionQuery;
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const rows = sessions ?? [];

  const totalSessions = rows.length;
  const totalSettledSeconds = rows.reduce(
    (sum, s) => sum + (Number(s.settled_seconds) || 0),
    0,
  );
  const totalReservedSeconds = rows.reduce(
    (sum, s) => sum + (Number(s.reserved_seconds) || 0),
    0,
  );
  const settledSessions = rows.filter(
    (s) =>
      (s.status === "ended" || s.status === "expired") &&
      (Number(s.settled_seconds) || 0) > 0,
  ).length;
  const failedSessions = rows.filter((s) => s.status === "failed").length;
  const activeSessions = rows.filter(
    (s) => s.status === "reserved" || s.status === "active",
  ).length;

  // Rolling 7-day settled (fixed window ending now), independent of filter for quota view.
  const rollingFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: rollingSessions } = await supabaseAdmin
    .from("skg_ai_voice_sessions")
    .select("user_id, settled_seconds, reserved_seconds, status")
    .gte("created_at", rollingFrom)
    .limit(5000);

  const rollingRows = rollingSessions ?? [];
  const rolling7dSettledSeconds = rollingRows.reduce(
    (sum, s) => sum + (Number(s.settled_seconds) || 0),
    0,
  );
  const rolling7dReservedOpenSeconds = rollingRows
    .filter((s) => s.status === "reserved" || s.status === "active")
    .reduce((sum, s) => sum + (Number(s.reserved_seconds) || 0), 0);

  // Usage by user (filtered range) — settled only for "usage".
  const byUserMap = new Map<
    string,
    {
      user_id: string;
      sessions: number;
      settled_seconds: number;
      reserved_seconds: number;
      failed: number;
    }
  >();
  for (const s of rows) {
    const uid = String(s.user_id);
    const cur = byUserMap.get(uid) ?? {
      user_id: uid,
      sessions: 0,
      settled_seconds: 0,
      reserved_seconds: 0,
      failed: 0,
    };
    cur.sessions += 1;
    cur.settled_seconds += Number(s.settled_seconds) || 0;
    cur.reserved_seconds += Number(s.reserved_seconds) || 0;
    if (s.status === "failed") cur.failed += 1;
    byUserMap.set(uid, cur);
  }

  const usageByUser = [...byUserMap.values()]
    .sort((a, b) => b.settled_seconds - a.settled_seconds)
    .slice(0, 50);

  // Attach minimal user labels (no unnecessary PII).
  const userIds = usageByUser.map((u) => u.user_id);
  const userLabels: Record<string, { display_ref: string }> = {};
  if (userIds.length > 0) {
    const { data: users } = await supabaseAdmin
      .from("users")
      .select("id, phone, first_name, last_name")
      .in("id", userIds);
    for (const u of users ?? []) {
      const mobile = u.phone ? String(u.phone) : "";
      const name = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
      const masked =
        mobile.length >= 4
          ? `****${mobile.slice(-4)}`
          : name
            ? name.slice(0, 24)
            : u.id.slice(0, 8);
      userLabels[u.id] = { display_ref: masked };
    }
  }

  const usageByUserLabeled = usageByUser.map((u) => ({
    ...u,
    display_ref: userLabels[u.user_id]?.display_ref ?? u.user_id.slice(0, 8),
    // Per-user remaining vs weekly allowance using rolling 7d settled for that user.
    remaining_allowance_seconds: Math.max(
      0,
      weeklyAllowance -
        rollingRows
          .filter((r) => String(r.user_id) === u.user_id)
          .reduce((sum, r) => sum + (Number(r.settled_seconds) || 0), 0),
    ),
  }));

  const durationHistory = rows
    .filter((s) => (Number(s.settled_seconds) || 0) > 0 || s.status === "ended")
    .slice(0, 100)
    .map((s) => ({
      id: s.id,
      user_id: s.user_id,
      status: s.status,
      settled_seconds: s.settled_seconds,
      reserved_seconds: s.reserved_seconds,
      created_at: s.created_at,
      ended_at: s.ended_at,
    }));

  // Event type counts in range (ledger), for ops visibility — not used as settled totals.
  const { data: events } = await supabaseAdmin
    .from("skg_ai_voice_usage_events")
    .select("event_type")
    .gte("created_at", fromIso)
    .lte("created_at", toIso)
    .limit(5000);

  const eventCounts: Record<string, number> = {};
  for (const e of events ?? []) {
    const t = String(e.event_type);
    eventCounts[t] = (eventCounts[t] ?? 0) + 1;
  }

  return NextResponse.json({
    ok: true,
    filters: { from: fromIso, to: toIso },
    settings: {
      weekly_allowance_seconds: weeklyAllowance,
      max_session_seconds: settings?.max_session_seconds ?? null,
      voice_enabled: settings?.voice_enabled ?? false,
      emergency_disabled: settings?.emergency_disabled ?? false,
    },
    summary: {
      total_sessions: totalSessions,
      total_settled_seconds: totalSettledSeconds,
      total_reserved_seconds: totalReservedSeconds,
      settled_sessions: settledSessions,
      failed_sessions: failedSessions,
      active_sessions: activeSessions,
      rolling_7d_settled_seconds: rolling7dSettledSeconds,
      rolling_7d_open_reserved_seconds: rolling7dReservedOpenSeconds,
      note:
        "Settled seconds are authoritative usage. Reserved/open seconds are leases, not settled usage.",
    },
    usage_by_user: usageByUserLabeled,
    duration_history: durationHistory,
    event_counts: eventCounts,
  });
}
