import { cookies } from "next/headers";

import { ADMIN_SESSION_COOKIE } from "@/lib/admin-auth";
import { hasAdminSession } from "@/lib/admin-session";

/**
 * Server-only caller for the secure admin Edge Functions.
 * The browser session cookie is verified here, then forwarded as
 * `x-admin-session` and `skg_admin_session`. The session secret and
 * service-role key are never sent to the browser, and this module does
 * not query notification or verification tables.
 */

const SAFE_UNAVAILABLE = "Admin service is unavailable.";
const SAFE_UNCONFIGURED = "Admin service is not configured.";

export type AdminOpsResult =
  | { ok: true; payload: unknown }
  | { ok: false; status: number; error: string };

function functionsBaseUrl(): string | null {
  const override = process.env.ADMIN_OPS_FUNCTIONS_BASE_URL?.trim();
  if (override) return override.replace(/\/$/, "");
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!supabaseUrl) return null;
  return `${supabaseUrl.replace(/\/$/, "")}/functions/v1`;
}

export async function readAdminOpsSession(): Promise<string | null> {
  const cookieStore = await cookies();
  if (!hasAdminSession(cookieStore)) return null;
  const value = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
  return value || null;
}

export async function callAdminOpsFunction(
  functionName: "admin-notifications" | "admin-member-verification",
  body: Record<string, unknown>,
): Promise<AdminOpsResult> {
  const session = await readAdminOpsSession();
  if (!session) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  const baseUrl = functionsBaseUrl();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";
  if (!baseUrl || !anonKey) {
    return { ok: false, status: 503, error: SAFE_UNCONFIGURED };
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
    "x-admin-session": session,
    Cookie: `skg_admin_session=${session}`,
  };

  try {
    const response = await fetch(`${baseUrl}/${functionName}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });

    const payload = (await response.json().catch(() => null)) as unknown;
    const record =
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as { ok?: unknown })
        : null;

    if (!response.ok || record?.ok === false) {
      console.error(
        `admin ops ${functionName} ${String(body.action ?? "")} failed`,
        response.status,
      );
      return { ok: false, status: 502, error: SAFE_UNAVAILABLE };
    }

    return { ok: true, payload };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    console.error(
      `admin ops ${functionName} ${String(body.action ?? "")} ${timedOut ? "timed out" : "unreachable"}`,
    );
    return { ok: false, status: 502, error: SAFE_UNAVAILABLE };
  }
}
