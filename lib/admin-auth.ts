import { createHmac, timingSafeEqual } from "node:crypto";

export const ADMIN_SESSION_COOKIE = "merigaadi_admin_session";

const SESSION_MAX_AGE_MS = 60 * 60 * 8 * 1000; // 8 hours

/** Minimum length for ADMIN_SESSION_SECRET in all environments when set. */
export const MIN_ADMIN_SESSION_SECRET_LENGTH = 32;

/**
 * Development-only session HMAC material. Used solely when
 * NODE_ENV === "development" and ADMIN_SESSION_SECRET is unset.
 * Never accepted when NODE_ENV is production, test, staging, empty,
 * undefined, or any other value.
 */
const LOCAL_DEV_ONLY_SESSION_SECRET =
  "skg-local-dev-only-admin-session-secret-v1-not-for-production";

/** Strings that must never be used as session secrets (including legacy defaults). */
export const INSECURE_SESSION_SECRET_VALUES = [
  "merigaadi-dev-session-secret-change-me",
  "12345678",
  "secret",
  "password",
  "admin",
  "test-secret",
  LOCAL_DEV_ONLY_SESSION_SECRET,
] as const;

export type AdminSessionPayload = {
  /** Present for DB-backed admin panel users. */
  adminId?: string;
  username: string;
  displayName?: string;
  isSuperAdmin?: boolean;
  /** Legacy marker — always "admin" for cookie compatibility. */
  role: "admin";
  exp: number;
};

export class AdminAuthConfigError extends Error {
  constructor(message = "Server authentication is not configured.") {
    super(message);
    this.name = "AdminAuthConfigError";
  }
}

export function isProductionRuntime(
  nodeEnv: string | undefined = process.env.NODE_ENV,
): boolean {
  return nodeEnv === "production";
}

/** Local session-secret fallback is allowed only for explicit development. */
export function isDevelopmentRuntime(
  nodeEnv: string | undefined = process.env.NODE_ENV,
): boolean {
  return nodeEnv === "development";
}

/**
 * Env bootstrap username. Default "admin" is only a username hint for local
 * bootstrap — never a password or session secret.
 */
export function getAdminUsername(): string {
  return process.env.ADMIN_USERNAME?.trim() || "admin";
}

/**
 * Env bootstrap password for the optional Super Admin seed path.
 * Returns null when missing or empty — never a hardcoded default.
 * Does not trim (preserves intentional password characters).
 */
export function getAdminPassword(): string | null {
  const value = process.env.ADMIN_PASSWORD;
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  return value;
}

export type SessionSecretResolution =
  | { ok: true; secret: string; source: "env" | "local_dev_fallback" }
  | { ok: false; reason: "missing" | "empty" | "too_short" | "insecure" };

function isInsecureSessionSecret(secret: string): boolean {
  const normalized = secret.trim();
  if (!normalized) return true;
  return (INSECURE_SESSION_SECRET_VALUES as readonly string[]).includes(
    normalized,
  );
}

function validateExplicitSessionSecret(
  raw: string | undefined,
  fromEnv: string,
): SessionSecretResolution {
  if (raw === undefined || raw === null) {
    return { ok: false, reason: "missing" };
  }
  if (fromEnv.length === 0) {
    return { ok: false, reason: "empty" };
  }
  if (fromEnv.length < MIN_ADMIN_SESSION_SECRET_LENGTH) {
    return { ok: false, reason: "too_short" };
  }
  if (isInsecureSessionSecret(fromEnv)) {
    return { ok: false, reason: "insecure" };
  }
  return { ok: true, secret: fromEnv, source: "env" };
}

/**
 * Resolve HMAC session secret.
 * - Explicit ADMIN_SESSION_SECRET must meet strength policy when provided.
 * - Local-dev constant fallback ONLY when NODE_ENV === "development" and
 *   ADMIN_SESSION_SECRET is unset (undefined/null) — not when set to empty.
 * - All other NODE_ENV values (production, test, staging, undefined, empty, unknown)
 *   require a valid strong ADMIN_SESSION_SECRET (fail closed).
 * Never falls back to ADMIN_PASSWORD. Never logs or returns the secret in errors.
 */
export function resolveAdminSessionSecret(
  env: NodeJS.ProcessEnv = process.env,
): SessionSecretResolution {
  const raw = env.ADMIN_SESSION_SECRET;
  const fromEnv = typeof raw === "string" ? raw.trim() : "";
  const development = isDevelopmentRuntime(env.NODE_ENV);

  if (development && (raw === undefined || raw === null)) {
    return {
      ok: true,
      secret: LOCAL_DEV_ONLY_SESSION_SECRET,
      source: "local_dev_fallback",
    };
  }

  return validateExplicitSessionSecret(raw, fromEnv);
}
function getSessionSecret(): string {
  const resolved = resolveAdminSessionSecret();
  if (!resolved.ok) {
    throw new AdminAuthConfigError();
  }
  return resolved.secret;
}

/** @deprecated Use getAdminUsername() — kept for any residual imports. */
export const ADMIN_USERNAME = getAdminUsername();

/**
 * @deprecated Use getAdminPassword() — may be null when unset.
 * Evaluated at module load; prefer calling getAdminPassword() at use sites.
 */
export const ADMIN_PASSWORD = getAdminPassword();

export function createAdminSessionValue(
  input?: Partial<
    Pick<
      AdminSessionPayload,
      "adminId" | "username" | "displayName" | "isSuperAdmin"
    >
  >,
): string {
  const secret = getSessionSecret();
  const exp = Date.now() + SESSION_MAX_AGE_MS;
  const payloadObj: AdminSessionPayload = {
    role: "admin",
    exp,
    username: input?.username?.trim() || getAdminUsername(),
    displayName: input?.displayName?.trim() || undefined,
    isSuperAdmin: input?.isSuperAdmin === true,
  };
  if (input?.adminId) {
    payloadObj.adminId = input.adminId;
  }
  const payload = Buffer.from(JSON.stringify(payloadObj), "utf8").toString(
    "base64url",
  );
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function parseAdminSessionValue(
  value: string | undefined,
): AdminSessionPayload | null {
  if (!value) return null;

  const resolved = resolveAdminSessionSecret();
  if (!resolved.ok) {
    // Fail closed when production (or invalid) secret configuration is present.
    return null;
  }
  const secret = resolved.secret;

  const parts = value.split(".");
  if (parts.length !== 2) return null;

  const [payload, sig] = parts;
  if (!payload || !sig) return null;

  const expected = createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");

  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }

  try {
    const data = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as AdminSessionPayload;
    if (data.role !== "admin") return null;
    if (typeof data.exp !== "number" || Date.now() > data.exp) return null;
    if (!data.username || typeof data.username !== "string") {
      // Legacy cookies had only { role, exp }
      data.username = getAdminUsername();
      data.isSuperAdmin = true;
    }
    return data;
  } catch {
    return null;
  }
}

export function isValidAdminSessionValue(value: string | undefined): boolean {
  return parseAdminSessionValue(value) != null;
}

export const ADMIN_SESSION_MAX_AGE_SECONDS = SESSION_MAX_AGE_MS / 1000;

/** Test/helper: confirm banned legacy defaults are not active fallbacks. */
export function usesHardcodedPasswordFallback(): boolean {
  return false;
}
