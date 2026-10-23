import { NextResponse } from "next/server";

import {
  requireAdminApi,
  safeErrorMessage,
} from "@/lib/in-app-announcements/admin-api";
import { clientMetaFromRequest, recordFailure, recordSuccess } from "@/lib/admin-audit";
import {
  DEFAULT_CLOSE_BUTTON,
  validateAnnouncementConfig,
} from "@/lib/in-app-announcements/types";

export async function GET(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const category = searchParams.get("category");
  const q = (searchParams.get("q") ?? "").trim();

  let query = auth.supabase
    .from("in_app_announcements")
    .select("*")
    .is("archived_at", null)
    .order("updated_at", { ascending: false });

  if (status && status !== "all") {
    query = query.eq("status", status);
  }
  if (category && category !== "all") {
    query = query.eq("category", category);
  }
  if (q) {
    query = query.or(
      `internal_name.ilike.%${q}%,internal_description.ilike.%${q}%`,
    );
  }

  const { data, error } = await query.limit(200);

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true, items: data ?? [] });
}

export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();
    const internalName = String(body.internal_name ?? "").trim();
    if (!internalName) {
      return NextResponse.json(
        { ok: false, error: "Internal notification name is required." },
        { status: 400 },
      );
    }

    const configError = validateAnnouncementConfig(body);
    if (configError) {
      return NextResponse.json(
        { ok: false, error: configError },
        { status: 400 },
      );
    }

    const payload = {
      internal_name: internalName,
      category: body.category ?? "other",
      internal_description: body.internal_description ?? null,
      priority: Number(body.priority ?? 100),
      status: body.status ?? "draft",
      image_url: body.image_url ?? null,
      image_fit: body.image_fit ?? "contain",
      background_color: body.background_color ?? "#000000",
      primary_button: body.primary_button ?? null,
      secondary_button: body.secondary_button ?? null,
      close_button: body.close_button ?? DEFAULT_CLOSE_BUTTON,
      dismissal_type: body.dismissal_type ?? "close_button",
      show_close: body.show_close ?? true,
      outside_tap_closes: body.outside_tap_closes ?? false,
      back_button_closes: body.back_button_closes ?? true,
      auto_dismiss: body.auto_dismiss ?? false,
      auto_dismiss_seconds: body.auto_dismiss_seconds ?? null,
      close_after_audio_ends: body.close_after_audio_ends ?? false,
      delay_after_audio_seconds: body.delay_after_audio_seconds ?? 0,
      is_mandatory: body.is_mandatory ?? false,
      record_acceptance: body.record_acceptance ?? false,
      content_version: body.content_version ?? "1",
      is_legal_consent: body.is_legal_consent ?? false,
      audio_enabled: body.audio_enabled ?? false,
      audio_source: body.audio_source ?? "upload",
      audio_url: body.audio_url ?? null,
      tts_text: body.tts_text ?? null,
      tts_language: body.tts_language ?? null,
      audio_autoplay: body.audio_autoplay ?? true,
      show_replay_button: body.show_replay_button ?? false,
      show_mute_button: body.show_mute_button ?? true,
      audience_type: body.audience_type ?? "all_users",
      active_within_days: body.active_within_days ?? null,
      trigger_type: body.trigger_type ?? "app_open",
      trigger_feature_key: body.trigger_feature_key ?? null,
      trigger_delay_seconds: body.trigger_delay_seconds ?? 0,
      show_once_per_session: body.show_once_per_session ?? true,
      starts_at: body.starts_at ?? null,
      ends_at: body.ends_at ?? null,
      timezone: body.timezone ?? "Asia/Kolkata",
      frequency: body.frequency ?? "once_per_user",
      max_displays_per_user: body.max_displays_per_user ?? null,
      re_show_after_dismissal: body.re_show_after_dismissal ?? false,
      custom_interval_hours: body.custom_interval_hours ?? null,
      custom_interval_value: body.custom_interval_value ?? null,
      custom_interval_unit: body.custom_interval_unit ?? null,
      is_birthday_template: body.is_birthday_template ?? false,
      birthday_personalize_name: body.birthday_personalize_name ?? false,
    };

    const { data, error } = await auth.supabase
      .from("in_app_announcements")
      .insert(payload)
      .select("*")
      .single();

    if (error) {
      void recordFailure({
        actor: auth.actor,
        action: "announcement_created",
        module: "announcements",
        description: `Failed to create in-app popup "${internalName}"`,
        resourceType: "in_app_announcement",
        entityLabel: internalName,
        reason: error.message,
        ...clientMetaFromRequest(request),
      });
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 400 },
      );
    }

    void recordSuccess({
      actor: auth.actor,
      action: "announcement_created",
      module: "announcements",
      description: `In-app popup "${internalName}" created`,
      resourceType: "in_app_announcement",
      resourceId: data?.id != null ? String(data.id) : undefined,
      entityLabel: internalName,
      afterData: {
        internal_name: internalName,
        category: payload.category,
        status: payload.status,
        priority: payload.priority,
        audience_type: payload.audience_type,
        trigger_type: payload.trigger_type,
      },
      ...clientMetaFromRequest(request),
    });

    return NextResponse.json({ ok: true, item: data });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: safeErrorMessage(error, "Failed to create announcement") },
      { status: 500 },
    );
  }
}
