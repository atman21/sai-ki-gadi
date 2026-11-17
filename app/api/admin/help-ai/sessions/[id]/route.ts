import { NextResponse } from "next/server";

import { requireAdminPermission } from "@/lib/admin-api";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const gate = await requireAdminPermission("help_ai.view", {
    request,
    auditModule: "help_ai",
  });
  if (!gate.ok) return gate.response;

  const { id } = await context.params;

  const { data: session, error } = await supabaseAdmin
    .from("skg_ai_voice_sessions")
    .select(
      `id, user_id, status, language, lease_seconds, reserved_seconds, settled_seconds,
       lease_expires_at, started_at, ended_at, last_heartbeat_at, end_reason,
       device_id, created_at, updated_at`,
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  if (!session) {
    return NextResponse.json(
      { ok: false, error: "Session not found." },
      { status: 404 },
    );
  }

  const { data: user } = await supabaseAdmin
    .from("users")
    .select("id, phone")
    .eq("id", session.user_id)
    .maybeSingle();

  const mobile = user?.phone ? String(user.phone) : "";
  const user_display_ref =
    mobile.length >= 4 ? `****${mobile.slice(-4)}` : String(session.user_id).slice(0, 8);

  const { data: events } = await supabaseAdmin
    .from("skg_ai_voice_usage_events")
    .select("id, event_type, seconds_delta, created_at, idempotency_key")
    .eq("session_id", id)
    .order("created_at", { ascending: true })
    .limit(200);

  return NextResponse.json({
    ok: true,
    row: {
      ...session,
      user_display_ref,
    },
    events: events ?? [],
  });
}
