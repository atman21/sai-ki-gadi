// @ts-nocheck
/**
 * One combined birthday digest per Asia/Kolkata date.
 * Separate from Lucky Draw, booking send-fcm-all, and notification_outbox.
 *
 * Delivery modes (BIRTHDAY_PUSH_DELIVERY):
 * - unset → no FCM (safe default)
 * - staging → allowlisted non-prod project + BIRTHDAY_PUSH_TEST_TOKENS only
 * - enabled → allowlisted non-prod project + all registered FCM tokens
 * Live production project uecdmytikvwiosnyndxe is refused unconditionally.
 * Collective body lists today's birthday names once per Asia/Kolkata date.
 *
 * A success digest is not sent again that IST date. A later tick retries
 * only device hashes that do not already have a success row.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  BIRTHDAY_DIGEST_TITLE,
  BIRTHDAY_FCM_CHUNK,
  BIRTHDAY_SCHEDULED_KEY,
  BIRTHDAY_STALE_PENDING_MS,
  DIGEST_STATUS_WRITE_ATTEMPTS,
  decideDigestAttempt,
  evaluateBirthdayDeliveryGate,
  formatBirthdayDigestBody,
  getKolkataClock,
  isBirthdayFcmToken,
  isBirthdayOnKolkataDate,
  isPermanentFcmTokenError,
  maskPushToken,
  normalizeSendTime,
  orderedBirthdayNames,
  parseTestTokenAllowlist,
  pendingTokenTargets,
  restrictToTestAllowlist,
  selectProductRecipients,
  summarizeDeliveryAttempt,
} from "./birthday-notification-schedule.ts";

const LOG = "[BirthdayNotification]";
const ANDROID_CHANNEL_ID = "merigadi-sound-v5";
const ANDROID_SOUND = "saikigadi_notification_new";
const BIRTHDAY_ROUTE = "/(app)";
const USER_PAGE = 1000;

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabase = createClient(supabaseUrl, serviceRoleKey);

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function isAuthorized(req) {
  if (!serviceRoleKey) return false;
  const auth = req.headers.get("Authorization") ?? "";
  return auth === `Bearer ${serviceRoleKey}`;
}

async function hashToken(token) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function getFirebaseAccessToken() {
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
  const encode = (obj) =>
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
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${signingInput}.${signatureB64}`,
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    throw new Error("Firebase access token not received");
  }
  return tokenData.access_token;
}

async function sendFcmToToken(token, title, body, accessToken, projectId) {
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

  let res;
  try {
    res = await fetch(
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, token, error: message, permanentInvalid: false };
  }

  let data = {};
  try {
    data = await res.json();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, token, error: message, permanentInvalid: false };
  }

  if (!res.ok) {
    const errorCode =
      typeof data?.error?.status === "string" ? data.error.status : undefined;
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

async function deleteInvalidToken(token) {
  const { error } = await supabase
    .from("user_push_tokens")
    .delete()
    .eq("expo_push_token", token);
  if (error) {
    console.log(`${LOG} Token cleanup skipped`, {
      token: maskPushToken(token),
      error: error.message,
    });
    return;
  }
  console.log(`${LOG} Removed invalid token`, { token: maskPushToken(token) });
}

async function listUsersWithBirthDate() {
  const rows = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("users")
      .select("id, first_name, last_name, birth_date")
      .not("birth_date", "is", null)
      .order("id", { ascending: true })
      .range(from, from + USER_PAGE - 1);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < USER_PAGE) break;
    from += USER_PAGE;
  }
  return rows;
}

async function listDigestDevices(mode, allowlistHashes) {
  const { data, error } = await supabase
    .from("user_push_tokens")
    .select("user_id, expo_push_token");
  if (error) throw error;

  const product = [];
  const rawByHash = new Map();
  for (const row of data ?? []) {
    const token = row.expo_push_token;
    if (!isBirthdayFcmToken(token)) continue;
    const hash = await hashToken(token);
    product.push({ hash, userId: row.user_id });
    rawByHash.set(hash, token);
  }

  const selected = mode === "staging"
    ? restrictToTestAllowlist(selectProductRecipients(product), allowlistHashes)
    : selectProductRecipients(product);
  return selected.map((recipient) => ({
    ...recipient,
    token: rawByHash.get(recipient.hash),
  })).filter((recipient) => typeof recipient.token === "string");
}

async function loadDigest(dateKey) {
  const { data, error } = await supabase
    .from("birthday_notification_digests")
    .select("id, status, body, locked_at, lock_token")
    .eq("birthday_date", dateKey)
    .eq("scheduled_key", BIRTHDAY_SCHEDULED_KEY)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function loadSucceededHashes(digestId) {
  const { data, error } = await supabase
    .from("birthday_notification_device_deliveries")
    .select("token_hash")
    .eq("digest_id", digestId)
    .eq("status", "success");
  if (error) throw error;
  return new Set((data ?? []).map((row) => row.token_hash));
}

async function writeReturningId(run) {
  let lastError = "write failed";
  for (let attempt = 1; attempt <= DIGEST_STATUS_WRITE_ATTEMPTS; attempt++) {
    const { data, error } = await run();
    if (!error && data?.id) return { ok: true, id: data.id, lockToken: data.lock_token };
    lastError = error?.message ?? "write was not persisted";
  }
  return { ok: false, error: lastError };
}

async function claimDigest(dateKey, body, birthdayCount, existing, decision) {
  if (decision.action === "send" && decision.mode === "insert") {
    const lockToken = crypto.randomUUID();
    const wrote = await writeReturningId(() =>
      supabase
        .from("birthday_notification_digests")
        .insert({
          birthday_date: dateKey,
          scheduled_key: BIRTHDAY_SCHEDULED_KEY,
          status: "pending",
          title: BIRTHDAY_DIGEST_TITLE,
          body,
          birthday_count: birthdayCount,
          lock_token: lockToken,
          locked_at: new Date().toISOString(),
        })
        .select("id, lock_token")
        .maybeSingle(),
    );
    if (wrote.ok) {
      return {
        claimed: true,
        finalizeOnly: false,
        id: wrote.id,
        lockToken: wrote.lockToken,
      };
    }
    const again = await loadDigest(dateKey);
    if (!again?.id) throw new Error(wrote.error);
    return { claimed: false, reason: "in_flight" };
  }

  const lockToken = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  let update = supabase
    .from("birthday_notification_digests")
    .update({
      status: "pending",
      lock_token: lockToken,
      locked_at: nowIso,
      updated_at: nowIso,
      error_message: null,
    })
    .eq("id", existing.id)
    .eq("birthday_date", dateKey)
    .eq("scheduled_key", BIRTHDAY_SCHEDULED_KEY);

  if (existing.status === "pending") {
    const cutoff = new Date(Date.now() - BIRTHDAY_STALE_PENDING_MS).toISOString();
    update = update.eq("status", "pending").lt("locked_at", cutoff);
  } else {
    update = update.in("status", ["partial", "failure"]);
  }

  const wrote = await writeReturningId(() =>
    update.select("id, lock_token").maybeSingle(),
  );
  if (!wrote.ok) return { claimed: false, reason: "in_flight" };
  return {
    claimed: true,
    finalizeOnly: decision.action === "finalize",
    id: wrote.id,
    lockToken: wrote.lockToken,
  };
}

async function recordDevice(digestId, hash, status, errorMessage) {
  const wrote = await writeReturningId(() =>
    supabase
      .from("birthday_notification_device_deliveries")
      .upsert(
        {
          digest_id: digestId,
          token_hash: hash,
          status,
          error_message: errorMessage ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "digest_id,token_hash" },
      )
      .select("id")
      .maybeSingle(),
  );
  return wrote.ok;
}

async function persistDigestStatus(digestId, lockToken, status, errorMessage) {
  const wrote = await writeReturningId(() =>
    supabase
      .from("birthday_notification_digests")
      .update({
        status,
        sent_at: new Date().toISOString(),
        error_message: errorMessage ?? null,
        updated_at: new Date().toISOString(),
        lock_token: null,
        locked_at: null,
      })
      .eq("id", digestId)
      .eq("lock_token", lockToken)
      .select("id")
      .maybeSingle(),
  );
  if (!wrote.ok) {
    throw new Error(`Digest status was not persisted: ${wrote.error}`);
  }
}

async function deliverDigest(targets, title, body) {
  const projectId = Deno.env.get("FIREBASE_PROJECT_ID");
  if (!projectId) throw new Error("Missing FIREBASE_PROJECT_ID");
  const accessToken = targets.length > 0 ? await getFirebaseAccessToken() : "";
  const outcomes = [];

  for (let index = 0; index < targets.length; index += BIRTHDAY_FCM_CHUNK) {
    const chunk = targets.slice(index, index + BIRTHDAY_FCM_CHUNK);
    const settled = await Promise.allSettled(
      chunk.map((target) =>
        sendFcmToToken(target.token, title, body, accessToken, projectId),
      ),
    );

    for (let offset = 0; offset < chunk.length; offset++) {
      const target = chunk[offset];
      const settledItem = settled[offset];
      if (settledItem.status === "rejected") {
        const reason = settledItem.reason instanceof Error
          ? settledItem.reason.message
          : String(settledItem.reason);
        outcomes.push({ hash: target.hash, status: "failure", error: reason, token: target.token });
        continue;
      }
      const result = settledItem.value;
      if (result.success) {
        outcomes.push({ hash: target.hash, status: "success", token: target.token });
        continue;
      }
      console.log(`${LOG} FCM failure`, {
        token: maskPushToken(target.token),
        error: result.error ?? "unknown",
      });
      if (result.permanentInvalid) await deleteInvalidToken(target.token);
      outcomes.push({
        hash: target.hash,
        status: "failure",
        error: result.error ?? "FCM send failed",
        token: target.token,
      });
    }
  }

  return outcomes;
}

Deno.serve(async (req) => {
  console.log(`${LOG} Started`);
  try {
    if (req.method !== "POST") return json(405, { ok: false, error: "Method not allowed" });
    if (!supabaseUrl || !serviceRoleKey) {
      return json(503, { ok: false, error: "Server configuration incomplete" });
    }
    if (!isAuthorized(req)) {
      console.log(`${LOG} Unauthorized`);
      return json(401, { ok: false, error: "Unauthorized" });
    }

    const testTokens = parseTestTokenAllowlist(Deno.env.get("BIRTHDAY_PUSH_TEST_TOKENS"));
    const gate = evaluateBirthdayDeliveryGate({
      deliveryFlag: Deno.env.get("BIRTHDAY_PUSH_DELIVERY"),
      supabaseUrl,
      testTokens,
    });
    if (!gate.allowed) {
      console.log(`${LOG} Completed`, { skipped: gate.reason });
      return json(200, { ok: true, skipped: gate.reason });
    }

    let requestBody = {};
    try {
      const text = await req.text();
      if (text.trim()) requestBody = JSON.parse(text);
    } catch {
      return json(400, { ok: false, error: "Invalid JSON body" });
    }
    if (requestBody.force === true) {
      return json(200, { ok: true, skipped: "force_disabled" });
    }
    const dryRun = requestBody.dryRun === true;

    const { dateKey, hhmm, minutes } = getKolkataClock();
    const { data: settings, error: settingsError } = await supabase
      .from("birthday_notification_settings")
      .select("enabled, send_time")
      .eq("id", 1)
      .maybeSingle();
    if (settingsError) throw settingsError;

    const enabled = settings?.enabled !== false;
    const sendTime = normalizeSendTime(settings?.send_time ?? "09:00");
    if (!enabled) return json(200, { ok: true, skipped: "disabled" });
    if (!sendTime) return json(200, { ok: true, skipped: "invalid_send_time" });

    let users = [];
    const rpc = await supabase.rpc("list_users_with_birthday_on", { p_date: dateKey });
    if (!rpc.error && Array.isArray(rpc.data)) {
      users = rpc.data.map((row) => ({
        id: row.id,
        first_name: row.first_name ?? null,
        last_name: row.last_name ?? null,
        birth_date: dateKey,
      }));
    } else {
      users = (await listUsersWithBirthDate()).filter((user) =>
        isBirthdayOnKolkataDate(user.birth_date, dateKey),
      );
    }
    const names = orderedBirthdayNames(
      users.map((user) => ({
        id: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
      })),
    );
    const body = formatBirthdayDigestBody(names);
    console.log(`${LOG} Birthday users`, { date: dateKey, count: names.length });
    if (!body) {
      return json(200, {
        ok: true,
        skipped: "no_birthdays",
        date: dateKey,
        kolkataTime: hhmm,
      });
    }

    const allowlistHashes = new Set();
    for (const token of testTokens) allowlistHashes.add(await hashToken(token));
    const recipients = await listDigestDevices(gate.mode, allowlistHashes);
    if (recipients.length === 0) {
      return json(200, {
        ok: true,
        skipped: "no_authorized_tokens",
        date: dateKey,
        kolkataTime: hhmm,
        birthdayCount: names.length,
      });
    }

    const existing = await loadDigest(dateKey);
    const succeeded = existing?.id
      ? await loadSucceededHashes(existing.id)
      : new Set();
    const pending = pendingTokenTargets(recipients, succeeded);
    const decision = decideDigestAttempt({
      birthdayCount: names.length,
      nowMinutes: minutes,
      sendTime,
      existing: existing
        ? {
            status: existing.status,
            lockedAtMs: existing.locked_at ? new Date(existing.locked_at).getTime() : null,
            body: existing.body,
          }
        : null,
      nowMs: Date.now(),
      undeliveredCount: pending.length,
      deliveredCount: succeeded.size,
    });

    if (decision.action === "skip") {
      console.log(`${LOG} Completed`, { skipped: decision.reason, kolkataTime: hhmm });
      return json(200, {
        ok: true,
        skipped: decision.reason,
        date: dateKey,
        kolkataTime: hhmm,
        birthdayCount: names.length,
      });
    }

    const digestBody = existing?.body || body;
    if (dryRun) {
      return json(200, {
        ok: true,
        dryRun: true,
        date: dateKey,
        kolkataTime: hhmm,
        birthdayCount: names.length,
        recipientCount: pending.length,
        decision: decision.action,
        projectRef: gate.projectRef,
      });
    }

    const claim = await claimDigest(
      dateKey,
      digestBody,
      names.length,
      existing,
      decision,
    );
    if (!claim.claimed) {
      return json(200, { ok: true, skipped: claim.reason ?? "in_flight", date: dateKey });
    }

    let outcomes = [];
    if (!claim.finalizeOnly) {
      const targets = pending.filter((target) => typeof target.token === "string");
      const sent = await deliverDigest(targets, BIRTHDAY_DIGEST_TITLE, digestBody);
      outcomes = [];
      for (const item of sent) {
        const recorded = await recordDevice(
          claim.id,
          item.hash,
          item.status === "success" ? "success" : "failure",
          item.error,
        );
        outcomes.push({
          hash: item.hash,
          status: recorded ? (item.status === "success" ? "success" : "failure") : "unrecorded",
        });
      }
    }

    const summary = summarizeDeliveryAttempt({
      targets: pending.map((target) => target.hash),
      outcomes,
    });
    const status = claim.finalizeOnly ? "success" : summary.status;
    const errorMessage = summary.failed.length + summary.unrecorded.length > 0
      ? `${summary.failed.length} failed, ${summary.unrecorded.length} unrecorded`
      : null;
    await persistDigestStatus(claim.id, claim.lockToken, status, errorMessage);

    console.log(`${LOG} Completed`, {
      date: dateKey,
      status,
      sent: summary.succeeded.length,
      failed: summary.failed.length,
    });
    return json(200, {
      ok: true,
      date: dateKey,
      kolkataTime: hhmm,
      birthdayCount: names.length,
      status,
      sent: summary.succeeded.length,
      failed: summary.failed.length,
      unrecorded: summary.unrecorded.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`${LOG} Completed`, { error: message });
    return json(500, { ok: false, error: message });
  }
});
