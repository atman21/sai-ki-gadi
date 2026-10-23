import { NextResponse } from "next/server";

import { requireAdminApi } from "@/lib/admin-api";
import {
  clientMetaFromRequest,
  recordChange,
  recordFailure,
} from "@/lib/admin-audit";
import { supabaseAdmin } from "@/lib/supabase-admin";

export type BirthdayNotificationSettings = {
  id: number;
  enabled: boolean;
  send_time: string;
  updated_at: string | null;
};

async function requireAdmin() {
  return requireAdminApi();
}

/** Normalize to HH:MM 24h Asia/Kolkata wall time. */
export function normalizeSendTime(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(input.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h > 23 || m > 59) {
    return null;
  }
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  try {
    const { data, error } = await supabaseAdmin
      .from("birthday_notification_settings")
      .select("id, enabled, send_time, updated_at")
      .eq("id", 1)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 },
      );
    }

    if (!data) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Birthday notification settings not found. Apply migration 051_birthday_notifications.sql.",
        },
        { status: 404 },
      );
    }

    return NextResponse.json({
      ok: true,
      settings: data as BirthdayNotificationSettings,
      timezone: "Asia/Kolkata",
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Something went wrong" },
      { status: 500 },
    );
  }
}

export async function PUT(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json();
    const enabled = body.enabled === true;
    const sendTime = normalizeSendTime(body.send_time ?? body.sendTime);

    if (!sendTime) {
      return NextResponse.json(
        {
          ok: false,
          error: "Send time must be HH:MM (24-hour), e.g. 09:00 or 11:30.",
        },
        { status: 400 },
      );
    }

    const { data: before } = await supabaseAdmin
      .from("birthday_notification_settings")
      .select("enabled, send_time")
      .eq("id", 1)
      .maybeSingle();

    const { data, error } = await supabaseAdmin
      .from("birthday_notification_settings")
      .upsert(
        {
          id: 1,
          enabled,
          send_time: sendTime,
        },
        { onConflict: "id" },
      )
      .select("id, enabled, send_time, updated_at")
      .single();

    if (error) {
      void recordFailure({
        actor: auth.actor,
        action: "birthday_notification_settings_updated",
        module: "notifications",
        description: "Failed to update birthday notification settings",
        resourceType: "birthday_notification_settings",
        resourceId: "1",
        reason: error.message,
        metadata: { enabled, send_time: sendTime },
        ...clientMetaFromRequest(req),
      });
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 },
      );
    }

    void recordChange({
      actor: auth.actor,
      action: "birthday_notification_settings_updated",
      module: "notifications",
      description: `Birthday notifications ${enabled ? "enabled" : "disabled"} at ${sendTime} IST`,
      resourceType: "birthday_notification_settings",
      resourceId: "1",
      changedFields: [
        ...(before?.enabled !== enabled ? ["enabled"] : []),
        ...(before?.send_time !== sendTime ? ["send_time"] : []),
      ],
      beforeData: before ?? null,
      afterData: { enabled, send_time: sendTime },
      ...clientMetaFromRequest(req),
    });

    return NextResponse.json({
      ok: true,
      settings: data as BirthdayNotificationSettings,
      timezone: "Asia/Kolkata",
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Something went wrong" },
      { status: 500 },
    );
  }
}
