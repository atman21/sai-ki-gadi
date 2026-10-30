/**
 * Pure helpers for resolving whether a server-only Supabase service-role key
 * is safely configured. No network I/O. Safe to unit-test with fake env objects.
 *
 * Never use NEXT_PUBLIC_* values as credentials.
 */

/** Built dynamically so Next cannot statically inline a NEXT_PUBLIC_ secret into client bundles. */
export function publicServiceRoleEnvName(): string {
  return ["NEXT_PUBLIC", "SUPABASE", "SERVICE", "ROLE", "KEY"].join("_");
}

export const SERVER_SERVICE_ROLE_ENV_NAME = "SUPABASE_SERVICE_ROLE_KEY";

/** Decode JWT payload claims without verifying signature (config checks only). */
export function jwtClaims(token: string): { role?: string; ref?: string } | null {
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

export function looksLikeServiceRoleKey(key: string): boolean {
  if (!key) return false;
  if (key.startsWith("sb_secret_")) return true;
  if (key.startsWith("eyJ") && key.includes(".")) {
    return jwtClaims(key)?.role === "service_role";
  }
  return false;
}

export function looksLikePublishableOrAnonKey(key: string): boolean {
  if (!key) return false;
  if (key.startsWith("sb_publishable_")) return true;
  if (key.startsWith("eyJ") && key.includes(".")) {
    return jwtClaims(key)?.role === "anon";
  }
  return false;
}

export type ServiceRoleConfig = {
  serverKeyConfigured: boolean;
  publicKeyNamePresent: boolean;
  usingServiceRole: boolean;
  issue: string | null;
};

/**
 * Resolve service-role readiness from an env bag.
 * - Credentials come only from SUPABASE_SERVICE_ROLE_KEY.
 * - NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY is never used as a credential
 *   and must not be used as a silent fallback.
 * - Presence of the public env name always surfaces a migration issue.
 */
export function resolveServiceRoleConfig(
  env: NodeJS.ProcessEnv = process.env,
): ServiceRoleConfig {
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";
  const serverKey = env[SERVER_SERVICE_ROLE_ENV_NAME]?.trim() ?? "";
  const publicName = publicServiceRoleEnvName();
  const publicRaw = env[publicName];
  const publicKeyNamePresent =
    typeof publicRaw === "string" && publicRaw.trim().length > 0;

  const publicIssue =
    "Remove NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY. Use server-only SUPABASE_SERVICE_ROLE_KEY instead (never NEXT_PUBLIC_).";

  const serverLooksValid =
    Boolean(serverKey) &&
    looksLikeServiceRoleKey(serverKey) &&
    !looksLikePublishableOrAnonKey(serverKey) &&
    serverKey !== anonKey;

  if (serverLooksValid) {
    return {
      serverKeyConfigured: true,
      publicKeyNamePresent,
      usingServiceRole: true,
      issue: publicKeyNamePresent ? publicIssue : null,
    };
  }

  if (publicKeyNamePresent) {
    return {
      serverKeyConfigured: Boolean(serverKey),
      publicKeyNamePresent: true,
      usingServiceRole: false,
      issue: publicIssue,
    };
  }

  if (!serverKey) {
    return {
      serverKeyConfigured: false,
      publicKeyNamePresent: false,
      usingServiceRole: false,
      issue:
        "SUPABASE_SERVICE_ROLE_KEY is not set in .env.local (server-only).",
    };
  }
  if (serverKey === anonKey) {
    return {
      serverKeyConfigured: true,
      publicKeyNamePresent: false,
      usingServiceRole: false,
      issue:
        "SUPABASE_SERVICE_ROLE_KEY is identical to the anon/publishable key.",
    };
  }
  if (looksLikePublishableOrAnonKey(serverKey)) {
    return {
      serverKeyConfigured: true,
      publicKeyNamePresent: false,
      usingServiceRole: false,
      issue:
        "SUPABASE_SERVICE_ROLE_KEY is a publishable key; use this project's secret/service_role key.",
    };
  }
  return {
    serverKeyConfigured: true,
    publicKeyNamePresent: false,
    usingServiceRole: false,
    issue:
      "SUPABASE_SERVICE_ROLE_KEY does not look like a service-role/secret key.",
  };
}

/** Server credential only — never returns a NEXT_PUBLIC_ value. */
export function getServerServiceRoleKey(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return env[SERVER_SERVICE_ROLE_ENV_NAME]?.trim() ?? "";
}
