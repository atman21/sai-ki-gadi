import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  getServerServiceRoleKey,
  resolveServiceRoleConfig,
} from "@/lib/supabase-service-role-config";

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

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";

const serviceRoleConfig = resolveServiceRoleConfig(process.env);
const supabaseServiceRoleKey = getServerServiceRoleKey(process.env);

/**
 * True only when a real server-only service-role/secret key is configured.
 * Public NEXT_PUBLIC_* values are never treated as credentials.
 */
export const usingServiceRole = serviceRoleConfig.usingServiceRole;

/** Human-readable reason when admin cannot bypass RLS (safe — no secrets). */
export function serviceRoleConfigIssue(): string | null {
  return resolveServiceRoleConfig(process.env).issue;
}

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Supabase env vars missing. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
  );
}

/**
 * Privileged admin client. Uses server-only service-role key when valid;
 * otherwise falls back to anon (RLS applies — protected tables return empty).
 * Prefer checking usingServiceRole / serviceRoleConfigIssue() before relying
 * on results. Never reads NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY as a credential.
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
