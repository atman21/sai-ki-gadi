/**
 * Birthday FCM blast — SEPARATE from Lucky Draw `send-lucky-draw-notification`
 * and booking `send-fcm-all`. Self-contained for Dashboard paste-deploy.
 * Channel/sound: same as Winner (merigadi-sound-v5 / saikigadi_notification_new).
 * Does NOT modify Winner or booking notification logic.
 * Does NOT touch in-app BirthdayWishPopup.
 *
 * Runtime: Supabase Edge (Deno). Ambient types live in ./deno-env.d.ts so this
 * file type-checks under the repo ESLint/TS toolchain without @ts-nocheck.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const LOG = "[BirthdayNotification]";
const TIMEZONE = "Asia/Kolkata";
const TITLE = "🎂 Birthday Wishes!";
const SLOT_WINDOW_MINUTES = 5;
const STALE_PENDING_MS = 15 * 60 * 1000;
const MAX_BIRTHDAYS_PER_RUN = 25;
const SCHEDULED_KEY = "scheduled";

const ANDROID_CHANNEL_ID = "merigadi-sound-v5";
const ANDROID_SOUND = "saikigadi_notification_new";
const BIRTHDAY_ROUTE = "/(app)";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabase = createClient(supabaseUrl, serviceRoleKey);

type SettingsRow = {
  enabled: boolean;
  send_time: string | null;
};

type BirthdayUser = {
  id: string;
  first_name: string | null;
  last_name: string | null;
};

async function getFirebaseAccessToken(): Promise<string> {
  const clientEmail = Deno.env.get("FIREBASE_CLIENT_EMAIL");
  const privateKey = Deno.env.get("FIREBASE_PRIVATE_KEY")?.replace(/\\n/g, "\n");

  if (!clientEmail || !privateKey) {
    throw new Error("Missing Firebase service account credentials");
  }

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: clientEmail,
    sub: clientEmail,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
  };

  const header = { alg: "RS256", typ: "JWT" };
  const encode = (obj: object) =>
    btoa(JSON.stringify(obj)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

  const signingInput = `${encode(header)}.${encode(payload)}`;
  const keyData = privateKey
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");

  const binaryKey = Uint8Array.from(atob(keyData), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(signingInput),
  );

  const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  const jwt = `${signingInput}.${signatureB64}`;
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    throw new Error("Firebase access token not received");
  }

  return tokenData.access_token as string;
}

function isPermanentFcmTokenError(errorCode?: string, message?: string): boolean {
  const code = (errorCode ?? "").toUpperCase();
  const msg = (message ?? "").toUpperCase();
  return (
    code.includes("UNREGISTERED") ||
    code.includes("NOT_FOUND") ||
    code.includes("INVALID_ARGUMENT") ||
    msg.includes("UNREGISTERED") ||
    msg.includes("REQUESTED ENTITY WAS NOT FOUND") ||
    msg.includes("INVALID REGISTRATION")
  );
}

async function sendFcmToToken(
  token: string,
  title: string,
  body: string,
  accessToken: string,
  projectId: string,
): Promise<{
  success: boolean;
  token: string;
  error?: string;
  permanentInvalid?: boolean;
}> {
  const payload = {
    message: {
      token,
      notification: { title, body },
      data: {
        title,
        body,  
        notification_type: "birthday",
        route: BIRTHDAY_ROUTE,
      },
      android: {
        priority: "high",
        notification: {
          channel_id: ANDROID_CHANNEL_ID,
          sound: ANDROID_SOUND,
        },
      },
    },
  };

  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(payload),
    },
  );

  const data = await res.json();
  if (!res.ok) {
    const errorCode =
      typeof data?.error?.status === "string"
        ? data.error.status
        : typeof data?.error?.details?.[0]?.errorCode === "string"
          ? data.error.details[0].errorCode
          : undefined;
    const errorMessage = data?.error?.message ?? "FCM send failed";
    return {
      success: false,
      token,
      error: errorMessage,
      permanentInvalid: isPermanentFcmTokenError(errorCode, errorMessage),
    };
  }

  return { success: true, token };
}

async function deleteInvalidToken(token: string): Promise<void> {
  const { error } = await supabase
    .from("user_push_tokens")
    .delete()
    .eq("expo_push_token", token);
  if (error) {
    console.log(`${LOG} Token cleanup skipped`, {
      token: maskToken(token),
      error: error.message,
    });
  } else {
    console.log(`${LOG} Removed invalid token`, { token: maskToken(token) });
  }
}

function isFcmNativeToken(token: string): boolean {
  return token.includes("APA91");
}

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function isAuthorized(req: Request): boolean {
  if (!serviceRoleKey) return false;
  const auth = req.headers.get("Authorization") ?? "";
  return auth === `Bearer ${serviceRoleKey}`;
}

function maskToken(token: string): string {
  if (token.length <= 12) return "***";
  return `${token.slice(0, 8)}…${token.slice(-4)}`;
}

function getKolkataNow(date = new Date()): {
  dateKey: string;
  hhmm: string;
  minutes: number;
} {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "00";

  const year = get("year");
  const month = get("month");
  const day = get("day");
  let hour = get("hour");
  const minute = get("minute");
  if (hour === "24") hour = "00";

  const hhmm = `${hour}:${minute}`;
  const minutes = Number(hour) * 60 + Number(minute);
  return { dateKey: `${year}-${month}-${day}`, hhmm, minutes };
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

function normalizeSendTime(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const mins = minutesOfDay(raw);
  if (mins === null) return null;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function isSendTimeDue(nowMinutes: number, sendTime: string): boolean {
  const start = minutesOfDay(sendTime);
  if (start === null) return false;
  return nowMinutes >= start && nowMinutes < start + SLOT_WINDOW_MINUTES;
}

function displayName(user: BirthdayUser): string {
  const name = [user.first_name, user.last_name]
    .filter((v) => typeof v === "string" && v.trim())
    .join(" ")
    .trim();
  return name || "Someone";
}

/**
 * Claim before send. Reclaims stale pending / failure so crashes can retry.
 * Never treats success as reclaimable (true once-per-day).
 */
async function claimBirthday(
  userId: string,
  birthdayDate: string,
  scheduledKey: string,
): Promise<{ claimed: boolean; logId?: string }> {
  const { data, error } = await supabase
    .from("birthday_notification_logs")
    .insert({
      birthday_user_id: userId,
      birthday_date: birthdayDate,
      scheduled_key: scheduledKey,
      status: "pending",
    })
    .select("id")
    .maybeSingle();

  if (!error && data?.id) {
    return { claimed: true, logId: data.id as string };
  }

  if (error && error.code !== "23505") {
    throw error;
  }

  const { data: existing, error: selErr } = await supabase
    .from("birthday_notification_logs")
    .select("id, status, created_at")
    .eq("birthday_user_id", userId)
    .eq("birthday_date", birthdayDate)
    .eq("scheduled_key", scheduledKey)
    .maybeSingle();

  if (selErr) throw selErr;
  if (!existing?.id) {
    return { claimed: false };
  }

  if (existing.status === "success") {
    console.log(`${LOG} Duplicate prevented`, { userId: userId.slice(0, 8) });
    return { claimed: false };
  }

  const createdAtRaw = existing.created_at;
  const createdAt =
    typeof createdAtRaw === "string" || typeof createdAtRaw === "number"
      ? new Date(createdAtRaw).getTime()
      : 0;
  const isStalePending =
    existing.status === "pending" &&
    Number.isFinite(createdAt) &&
    Date.now() - createdAt > STALE_PENDING_MS;
  const canRetry =
    existing.status === "failure" || isStalePending;

  if (!canRetry) {
    console.log(`${LOG} Duplicate prevented`, {
      userId: userId.slice(0, 8),
      status: existing.status,
    });
    return { claimed: false };
  }

  const { data: updated, error: updErr } = await supabase
    .from("birthday_notification_logs")
    .update({
      status: "pending",
      error_message: null,
      sent_at: null,
      devices_sent: null,
      devices_failed: null,
    })
    .eq("id", existing.id)
    .in("status", ["failure", "pending"])
    .select("id")
    .maybeSingle();

  if (updErr) throw updErr;
  if (!updated?.id) return { claimed: false };

  console.log(`${LOG} Reclaimed prior attempt`, {
    userId: userId.slice(0, 8),
    priorStatus: existing.status,
  });
  return { claimed: true, logId: updated.id as string };
}

async function finalizeLog(
  logId: string,
  status: "success" | "failure",
  errorMessage?: string,
  devicesSent?: number,
  devicesFailed?: number,
) {
  await supabase
    .from("birthday_notification_logs")
    .update({
      status,
      sent_at: new Date().toISOString(),
      error_message: errorMessage ?? null,
      devices_sent: devicesSent ?? null,
      devices_failed: devicesFailed ?? null,
    })
    .eq("id", logId);
}

async function sendToAllDevices(
  title: string,
  body: string,
): Promise<{ sent: number; failed: number }> {
  const projectId = Deno.env.get("FIREBASE_PROJECT_ID");
  if (!projectId) {
    throw new Error("Missing FIREBASE_PROJECT_ID");
  }

  const { data: rows, error } = await supabase
    .from("user_push_tokens")
    .select("user_id, expo_push_token");

  if (error) throw error;

  const tokenRows: Array<Record<string, unknown>> = Array.isArray(rows)
    ? rows
    : [];
  const tokens = tokenRows
    .map((r) => r.expo_push_token)
    .filter(
      (t): t is string =>
        typeof t === "string" && t.length > 0 && isFcmNativeToken(t),
    );

  const uniqueTokens = [...new Set(tokens)];
  console.log(`${LOG} Sending FCM`, { deviceCount: uniqueTokens.length });

  if (uniqueTokens.length === 0) {
    return { sent: 0, failed: 0 };
  }

  const accessToken = await getFirebaseAccessToken();
  const firebaseProjectId = projectId;

  const results = await Promise.all(
    uniqueTokens.map((token) =>
      sendFcmToToken(token, title, body, accessToken, firebaseProjectId),
    ),
  );

  const sent = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  for (const r of results) {
    if (!r.success) {
      console.log(`${LOG} FCM failure`, {
        token: maskToken(r.token),
        error: r.error ?? "unknown",
      });
      if (r.permanentInvalid) {
        await deleteInvalidToken(r.token);
      }
    }
  }

  if (sent > 0) {
    console.log(`${LOG} FCM success`, { sent, failed });
  }

  return { sent, failed };
}

async function processBirthdayUser(
  user: BirthdayUser,
  birthdayDate: string,
  scheduledKey: string,
): Promise<Record<string, unknown>> {
  const claim = await claimBirthday(user.id, birthdayDate, scheduledKey);
  if (!claim.claimed || !claim.logId) {
    return {
      birthdayUserId: user.id.slice(0, 8),
      status: "duplicate_prevented",
    };
  }

  const name = displayName(user);
  const body = `Today is ${name}'s birthday! 🎉 Wish them a very Happy Birthday!`;

  try {
    const { sent, failed } = await sendToAllDevices(TITLE, body);

    if (sent === 0 && failed === 0) {
      // No tokens — not a permanent success; allow retry later.
      await finalizeLog(
        claim.logId,
        "failure",
        "No valid device tokens",
        0,
        0,
      );
      return {
        birthdayUserId: user.id.slice(0, 8),
        status: "failure",
        sent: 0,
        failed: 0,
        reason: "no_tokens",
      };
    }

    if (sent === 0 && failed > 0) {
      await finalizeLog(
        claim.logId,
        "failure",
        `All ${failed} FCM sends failed`,
        sent,
        failed,
      );
      return {
        birthdayUserId: user.id.slice(0, 8),
        status: "failure",
        sent,
        failed,
      };
    }

    await finalizeLog(
      claim.logId,
      "success",
      failed > 0 ? `${failed} device(s) failed` : undefined,
      sent,
      failed,
    );
    return {
      birthdayUserId: user.id.slice(0, 8),
      status: "success",
      sent,
      failed,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.log(`${LOG} FCM failure`, { error: message });
    await finalizeLog(claim.logId, "failure", message);
    return {
      birthdayUserId: user.id.slice(0, 8),
      status: "failure",
      error: message,
    };
  }
}

Deno.serve(async (req) => {
  console.log(`${LOG} Started`);

  try {
    if (req.method !== "POST") {
      return json(405, { ok: false, error: "Method not allowed" });
    }

    if (!supabaseUrl || !serviceRoleKey) {
      return json(503, { ok: false, error: "Server configuration incomplete" });
    }

    if (!isAuthorized(req)) {
      console.log(`${LOG} Unauthorized`);
      return json(401, { ok: false, error: "Unauthorized" });
    }

    let body: { force?: boolean } = {};
    try {
      const text = await req.text();
      if (text.trim()) {
        body = JSON.parse(text) as { force?: boolean };
      }
    } catch {
      return json(400, { ok: false, error: "Invalid JSON body" });
    }

    const force = body.force === true;
    const { dateKey, hhmm, minutes } = getKolkataNow();

    const { data: settings, error: settingsError } = await supabase
      .from("birthday_notification_settings")
      .select("enabled, send_time")
      .eq("id", 1)
      .maybeSingle();

    if (settingsError) throw settingsError;

    const settingsRow = settings as SettingsRow | null;
    const enabled = settingsRow?.enabled !== false;
    const sendTime = normalizeSendTime(settingsRow?.send_time ?? "09:00");

    if (!force && !enabled) {
      console.log(`${LOG} Completed`, { skipped: "disabled" });
      return json(200, { ok: true, skipped: "disabled" });
    }

    if (!sendTime) {
      console.log(`${LOG} Completed`, { skipped: "invalid_send_time" });
      return json(200, { ok: true, skipped: "invalid_send_time" });
    }

    if (!force && !isSendTimeDue(minutes, sendTime)) {
      console.log(`${LOG} Completed`, {
        skipped: "not_due",
        sendTime,
        kolkataTime: hhmm,
      });
      return json(200, {
        ok: true,
        skipped: "not_due",
        sendTime,
        kolkataTime: hhmm,
        date: dateKey,
      });
    }

    const { data: birthdayUsers, error: usersError } = await supabase.rpc(
      "list_users_with_birthday_on",
      { p_date: dateKey },
    );

    if (usersError) throw usersError;

    const users = (birthdayUsers ?? []) as BirthdayUser[];
    console.log(`${LOG} Birthday users`, {
      date: dateKey,
      count: users.length,
    });

    if (users.length === 0) {
      console.log(`${LOG} Completed`, { skipped: "no_birthdays", date: dateKey });
      return json(200, {
        ok: true,
        skipped: "no_birthdays",
        date: dateKey,
        kolkataTime: hhmm,
      });
    }

    const scheduledKey = force
      ? `manual_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`
      : SCHEDULED_KEY;

    const toProcess = users.slice(0, MAX_BIRTHDAYS_PER_RUN);
    const results: Record<string, unknown>[] = [];

    for (const user of toProcess) {
      results.push(await processBirthdayUser(user, dateKey, scheduledKey));
    }

    console.log(`${LOG} Completed`, {
      date: dateKey,
      kolkataTime: hhmm,
      force,
      birthdayCount: users.length,
      processed: results.length,
      truncated: users.length > MAX_BIRTHDAYS_PER_RUN,
    });

    return json(200, {
      ok: true,
      date: dateKey,
      kolkataTime: hhmm,
      sendTime,
      force,
      birthdayCount: users.length,
      processed: results.length,
      truncated: users.length > MAX_BIRTHDAYS_PER_RUN,
      results,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.log(`${LOG} Completed`, { error: message });
    return json(500, { ok: false, error: message });
  }
});
