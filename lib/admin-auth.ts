import { createHmac, timingSafeEqual } from "node:crypto";

export const ADMIN_SESSION_COOKIE = "merigaadi_admin_session";

const SESSION_MAX_AGE_MS = 60 * 60 * 8 * 1000; // 8 hours (was 7 days)

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

/** Prefer env in production. Hardcoded fallback is documented as a known risk. */
export function getAdminUsername(): string {
  return process.env.ADMIN_USERNAME?.trim() || "admin";
}

export function getAdminPassword(): string {
  return process.env.ADMIN_PASSWORD ?? "12345678";
}

function getSessionSecret(): string {
  return (
    process.env.ADMIN_SESSION_SECRET?.trim() ||
    process.env.ADMIN_PASSWORD?.trim() ||
    "merigaadi-dev-session-secret-change-me"
  );
}

/** @deprecated Use getAdminUsername() — kept for any residual imports. */
export const ADMIN_USERNAME = getAdminUsername();

/** @deprecated Use getAdminPassword() — kept for any residual imports. */
export const ADMIN_PASSWORD = getAdminPassword();

export function createAdminSessionValue(
  input?: Partial<
    Pick<
      AdminSessionPayload,
      "adminId" | "username" | "displayName" | "isSuperAdmin"
    >
  >,
): string {
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
  const sig = createHmac("sha256", getSessionSecret())
    .update(payload)
    .digest("base64url");
  return `${payload}.${sig}`;
}

export function parseAdminSessionValue(
  value: string | undefined,
): AdminSessionPayload | null {
  if (!value) return null;

  const parts = value.split(".");
  if (parts.length !== 2) return null;

  const [payload, sig] = parts;
  if (!payload || !sig) return null;

  const expected = createHmac("sha256", getSessionSecret())
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
