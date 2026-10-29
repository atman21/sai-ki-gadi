import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  publicServiceRoleConfigured,
  publicServiceRoleStartupError,
} from "@/lib/service-role-env";

/**
 * Server-only privileged Supabase client for the Admin Panel.
 *
 * NEVER import this module from Client Components.
 * Service-role/secret keys must stay out of NEXT_PUBLIC_* vars.
 *
 * Development project (local Admin + Expo):
 *   https://lhzgfhbnfbztwnowxxoy.supabase.co
 * Production project (do not use from local Admin):
 *   https://uecdmytikvwiosnyndxe.supabase.co
 */

if (typeof window !== "undefined") {
  throw new Error(
    "lib/supabase-admin.ts is server-only and must not be imported in the browser.",
  );
}

const exposedServiceRole = publicServiceRoleStartupError();
if (exposedServiceRole) {
  throw new Error(exposedServiceRole);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";

/** Server-only — never NEXT_PUBLIC_ */
const supabaseServiceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";

/** Decode JWT payload claims without verifying signature (config checks only). */
function jwtClaims(token: string): { role?: string; ref?: string } | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    const json =
      typeof atob === "function"
        ? atob(padded)
        : Buffer.from(padded, "base64").toString("utf8");
    return JSON.parse(json) as { role?: string; ref?: string };
  } catch {
    return null;
  }
}

function looksLikeServiceRoleKey(key: string): boolean {
  if (!key) return false;
  // New Supabase secret key format
  if (key.startsWith("sb_secret_")) return true;
  // Legacy JWT — require role claim service_role (anon JWTs also start with eyJ)
  if (key.startsWith("eyJ") && key.includes(".")) {
    return jwtClaims(key)?.role === "service_role";
  }
  return false;
}

function looksLikePublishableOrAnonKey(key: string): boolean {
  if (!key) return false;
  if (key.startsWith("sb_publishable_")) return true;
  if (key.startsWith("eyJ") && key.includes(".")) {
    return jwtClaims(key)?.role === "anon";
  }
  return false;
}

/**
 * True only when a real service-role/secret key is configured server-side.
 * Publishable/anon keys do NOT bypass RLS.
 */
export const usingServiceRole =
  Boolean(supabaseServiceRoleKey) &&
  looksLikeServiceRoleKey(supabaseServiceRoleKey) &&
  !looksLikePublishableOrAnonKey(supabaseServiceRoleKey) &&
  supabaseServiceRoleKey !== supabaseAnonKey;

/** Human-readable reason when admin cannot bypass RLS (safe — no secrets). */
export function serviceRoleConfigIssue(): string | null {
  const exposed = publicServiceRoleStartupError();
  if (exposed || publicServiceRoleConfigured()) return exposed;

  if (usingServiceRole) return null;

  if (!supabaseServiceRoleKey) {
    return "SUPABASE_SERVICE_ROLE_KEY is not set in .env.local (server-only).";
  }
  if (supabaseServiceRoleKey === supabaseAnonKey) {
    return "SUPABASE_SERVICE_ROLE_KEY is identical to the anon/publishable key.";
  }
  if (looksLikePublishableOrAnonKey(supabaseServiceRoleKey)) {
    return "SUPABASE_SERVICE_ROLE_KEY is a publishable key; use this project's secret/service_role key.";
  }
  return "SUPABASE_SERVICE_ROLE_KEY does not look like a service-role/secret key.";
}

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Supabase env vars missing. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
  );
}

/**
 * Privileged admin client. Uses service-role key when valid; otherwise falls
 * back to anon (RLS applies — protected tables return empty). Prefer checking
 * usingServiceRole / serviceRoleConfigIssue() before relying on results.
 */
export const supabaseAdmin: SupabaseClient = createClient(
  supabaseUrl,
  usingServiceRole ? supabaseServiceRoleKey : supabaseAnonKey,
  {
    auth: { persistSession: false, autoRefreshToken: false },
  },
);

/** Host only — safe to display in UI. */
export function supabaseProjectHost(): string {
  try {
    return new URL(supabaseUrl).host;
  } catch {
    return "(invalid NEXT_PUBLIC_SUPABASE_URL)";
  }
}
