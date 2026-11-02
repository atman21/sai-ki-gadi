import { NextResponse } from "next/server";

import { requireAdminPermission } from "@/lib/in-app-announcements/admin-api";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Ctx) {
  const auth = await requireAdminPermission("announcements.view", {
    auditModule: "announcements",
  });
  if (!auth.ok) return auth.response;

  const { id } = await context.params;

  const [
    displayed,
    dismissed,
    primary,
    secondary,
    audioPlays,
    acceptances,
    recipients,
  ] = await Promise.all([
    auth.supabase
      .from("in_app_announcement_interactions")
      .select("id, user_id", { count: "exact" })
      .eq("announcement_id", id)
      .eq("event_type", "displayed"),
    auth.supabase
      .from("in_app_announcement_interactions")
      .select("id", { count: "exact", head: true })
      .eq("announcement_id", id)
      .eq("event_type", "dismissed"),
    auth.supabase
      .from("in_app_announcement_interactions")
      .select("id", { count: "exact", head: true })
      .eq("announcement_id", id)
      .eq("event_type", "primary_click"),
    auth.supabase
      .from("in_app_announcement_interactions")
      .select("id", { count: "exact", head: true })
      .eq("announcement_id", id)
      .eq("event_type", "secondary_click"),
    auth.supabase
      .from("in_app_announcement_interactions")
      .select("id", { count: "exact", head: true })
      .eq("announcement_id", id)
      .eq("event_type", "audio_play"),
    auth.supabase
      .from("in_app_announcement_acceptances")
      .select("id, user_id, acceptance_status", { count: "exact" })
      .eq("announcement_id", id)
      .eq("acceptance_status", "accepted"),
    auth.supabase
      .from("in_app_announcement_recipients")
      .select("id", { count: "exact", head: true })
      .eq("announcement_id", id),
  ]);

  const displayRows = displayed.data ?? [];
  const uniqueViews = new Set(displayRows.map((r) => r.user_id)).size;

  return NextResponse.json({
    ok: true,
    analytics: {
      targetedUsers: recipients.count ?? null,
      uniqueViews,
      totalDisplays: displayed.count ?? 0,
      primaryButtonClicks: primary.count ?? 0,
      secondaryButtonClicks: secondary.count ?? 0,
      dismissals: dismissed.count ?? 0,
      acceptances: acceptances.count ?? 0,
      pendingAcceptance: null,
      audioPlays: audioPlays.count ?? 0,
    },
  });
}
