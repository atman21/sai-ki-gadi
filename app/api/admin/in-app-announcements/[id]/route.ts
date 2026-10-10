import { NextResponse } from "next/server";

import {
  requireAdminApi,
  safeErrorMessage,
} from "@/lib/in-app-announcements/admin-api";
import { validateAnnouncementConfig } from "@/lib/in-app-announcements/types";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Ctx) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const { data, error } = await auth.supabase
    .from("in_app_announcements")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 400 },
    );
  }
  if (!data) {
    return NextResponse.json(
      { ok: false, error: "Announcement not found" },
      { status: 404 },
    );
  }

  const { count } = await auth.supabase
    .from("in_app_announcement_recipients")
    .select("id", { count: "exact", head: true })
    .eq("announcement_id", id);

  return NextResponse.json({
    ok: true,
    item: data,
    recipientCount: count ?? 0,
  });
}

export async function PUT(request: Request, context: Ctx) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  try {
    const { id } = await context.params;
    const body = await request.json();

    // Validate against the complete stored record, including status-only publish actions.
    const { data: existing, error: existingError } = await auth.supabase
      .from("in_app_announcements").select("*").eq("id", id).maybeSingle();
    if (existingError) return NextResponse.json({ ok: false, error: existingError.message }, { status: 400 });
    if (!existing) return NextResponse.json({ ok: false, error: "Announcement not found" }, { status: 404 });
    const configError = validateAnnouncementConfig({ ...existing, ...body });
    if (configError) {
      return NextResponse.json(
        { ok: false, error: configError },
        { status: 400 },
      );
    }

    const allowed = [
      "internal_name",
      "category",
      "internal_description",
      "priority",
      "status",
      "image_url",
      "image_fit",
      "background_color",
      "primary_button",
      "secondary_button",
      "close_button",
      "dismissal_type",
      "show_close",
      "outside_tap_closes",
      "back_button_closes",
      "auto_dismiss",
      "auto_dismiss_seconds",
      "close_after_audio_ends",
      "delay_after_audio_seconds",
      "is_mandatory",
      "record_acceptance",
      "content_version",
      "is_legal_consent",
      "audio_enabled",
      "audio_source",
      "audio_url",
      "tts_text",
      "tts_language",
      "audio_autoplay",
      "show_replay_button",
      "show_mute_button",
      "audience_type",
      "active_within_days",
      "trigger_type",
      "trigger_feature_key",
      "trigger_delay_seconds",
      "show_once_per_session",
      "starts_at",
      "ends_at",
      "timezone",
      "frequency",
      "max_displays_per_user",
      "re_show_after_dismissal",
      "custom_interval_hours",
      "custom_interval_value",
      "custom_interval_unit",
      "is_birthday_template",
      "birthday_personalize_name",
      "published_at",
      "archived_at",
    ] as const;

    const patch: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in body) patch[key] = body[key];
    }

    if (patch.status === "active" && !patch.published_at) {
      patch.published_at = new Date().toISOString();
    }
    if (patch.status === "unpublished") {
      // keep published_at for history
    }

    const { data, error } = await auth.supabase
      .from("in_app_announcements")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single();

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 400 },
      );
    }

    return NextResponse.json({ ok: true, item: data });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: safeErrorMessage(error, "Failed to update announcement"),
      },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: Request, context: Ctx) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;

  // Soft archive by default
  const { data, error } = await auth.supabase
    .from("in_app_announcements")
    .update({
      archived_at: new Date().toISOString(),
      status: "unpublished",
    })
    .eq("id", id)
    .select("id")
    .single();

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true, item: data });
}
