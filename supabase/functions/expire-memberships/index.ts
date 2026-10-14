/**
 * Membership expiry reconciler — calls service-role RPC `admin_expire_memberships`.
 *
 * Does NOT touch account ON/OFF (`users.status`).
 * Does NOT delete membership_history / payment rows — marks expired gold history
 * and sets expired users back to regular.
 *
 * Runtime: Supabase Edge (Deno). Schedule externally (VPS crontab / approved
 * scheduler). Do not enable in production without review.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const LOG = "[ExpireMemberships]";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabase = createClient(supabaseUrl, serviceRoleKey);

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

    // Optional empty JSON body for curl/cron callers.
    try {
      const text = await req.text();
      if (text.trim()) {
        JSON.parse(text);
      }
    } catch {
      return json(400, { ok: false, error: "Invalid JSON body" });
    }

    const { data, error } = await supabase.rpc("admin_expire_memberships");
    if (error) {
      console.log(`${LOG} RPC failed`, { error: error.message });
      return json(500, { ok: false, error: error.message });
    }

    const expiredCount =
      typeof data === "number" ? data : Number(data ?? 0);

    console.log(`${LOG} Completed`, {
      expiredCount: Number.isFinite(expiredCount) ? expiredCount : 0,
    });

    return json(200, {
      ok: true,
      expiredCount: Number.isFinite(expiredCount) ? expiredCount : 0,
      note: "users.status (account ON/OFF) is never modified; membership_history payment rows are preserved.",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.log(`${LOG} Completed`, { error: message });
    return json(500, { ok: false, error: message });
  }
});
