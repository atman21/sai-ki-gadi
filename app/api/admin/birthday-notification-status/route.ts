import { requireAdminPermission, safeErrorMessage } from "@/lib/admin-api";
import { NextResponse } from "next/server";


function getKolkataParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "00";
  let hour = get("hour");
  if (hour === "24") hour = "00";
  const dateKey = `${get("year")}-${get("month")}-${get("day")}`;
  const hhmm = `${hour}:${get("minute")}`;
  const minutes = Number(hour) * 60 + Number(get("minute"));
  return { dateKey, hhmm, minutes };
}

function minutesOfDay(hhmm: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h > 23 || m > 59) {
    return null;
  }
  return h * 60 + m;
}

/** Next 5-minute cron boundary in Asia/Kolkata (HH:MM label). */
function nextFiveMinuteCheckLabel(nowMinutes: number): string {
  const next = (Math.floor(nowMinutes / 5) + 1) * 5;
  const wrapped = next >= 24 * 60 ? next - 24 * 60 : next;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function formatAmPm(hhmm: string): string {
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!match) return hhmm;
  let h = Number(match[1]);
  const m = match[2];
  const suffix = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m} ${suffix}`;
}

/**
 * Real status for Birthday Notifications admin card (no fake metrics).
 */
export async function GET(request: Request) {
  const gate = await requireAdminPermission("birthday.view", {
    request,
    auditModule: "birthday",
  });
  if (!gate.ok) return gate.response;
  const supabaseAdmin = gate.supabase;

  try {
    const { dateKey, hhmm, minutes } = getKolkataParts();

    const [settingsRes, birthdayUsersRes, logsRes] = await Promise.all([
      supabaseAdmin
        .from("birthday_notification_settings")
        .select("enabled, send_time, updated_at")
        .eq("id", 1)
        .maybeSingle(),
      supabaseAdmin.rpc("list_users_with_birthday_on", { p_date: dateKey }),
      supabaseAdmin
        .from("birthday_notification_logs")
        .select(
          "id, birthday_user_id, status, sent_at, scheduled_key, created_at, error_message",
        )
        .eq("birthday_date", dateKey)
        .eq("scheduled_key", "scheduled")
        .order("created_at", { ascending: false }),
    ]);

    if (settingsRes.error) {
      return NextResponse.json(
        {
          ok: false,
          error: safeErrorMessage(
            settingsRes.error,
            "Unable to load birthday notification status.",
          ),
        },
        { status: 500 },
      );
    }

    const todayBirthdayCount = Array.isArray(birthdayUsersRes.data)
      ? birthdayUsersRes.data.length
      : 0;

    const logs = logsRes.data ?? [];
    const successCount = logs.filter((l) => l.status === "success").length;
    const failureCount = logs.filter((l) => l.status === "failure").length;
    const pendingCount = logs.filter((l) => l.status === "pending").length;

    const lastSuccess = logs.find((l) => l.status === "success" && l.sent_at);
    const lastFailure = logs.find((l) => l.status === "failure");

    const sendTime =
      typeof settingsRes.data?.send_time === "string"
        ? settingsRes.data.send_time
        : "09:00";
    const sendMinutes = minutesOfDay(sendTime);
    const nextCheckHhmm = nextFiveMinuteCheckLabel(minutes);
    const inSendWindow =
      sendMinutes !== null &&
      minutes >= sendMinutes &&
      minutes < sendMinutes + 5;

    return NextResponse.json({
      ok: true,
      timezone: "Asia/Kolkata",
      date: dateKey,
      kolkataTime: hhmm,
      kolkataTimeLabel: formatAmPm(hhmm),
      sendTime,
      sendTimeLabel: formatAmPm(sendTime),
      inSendWindow,
      nextCheckHhmm,
      nextCheckLabel: formatAmPm(nextCheckHhmm),
      settings: settingsRes.data ?? null,
      todayBirthdayCount,
      birthdayUsersError: birthdayUsersRes.error
        ? "Unable to load today's birthday users."
        : null,
      logsError: logsRes.error
        ? "Unable to load birthday notification logs."
        : null,
      processed: {
        success: successCount,
        failure: failureCount,
        pending: pendingCount,
        totalLogged: logs.length,
      },
      lastScheduledSuccessAt: lastSuccess?.sent_at ?? null,
      lastScheduledFailureAt: lastFailure?.sent_at ?? lastFailure?.created_at ?? null,
      lastScheduledFailureMessage: lastFailure?.error_message ?? null,
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Something went wrong" },
      { status: 500 },
    );
  }
}
