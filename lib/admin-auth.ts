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

const BLOCKED_ADMIN_PASSWORD = ["1234", "5678"].join("");
const BLOCKED_SESSION_SECRET = ["merigaadi-dev-session-secret", "change-me"].join(
  "-",
);
const MIN_SESSION_SECRET_LENGTH = 32;

export class AdminSessionConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminSessionConfigError";
  }
}

/** Username is not a secret. Password and session signing have no code default. */
export function getAdminUsername(): string {
  return process.env.ADMIN_USERNAME?.trim() || "admin";
}

/**
 * Env bootstrap password only. Missing and the historical development
 * password are refused so a forgotten env var cannot sign in.
 */
export function getAdminPassword(): string | null {
  const value = process.env.ADMIN_PASSWORD?.trim() ?? "";
  if (!value || value === BLOCKED_ADMIN_PASSWORD) return null;
  return value;
}

export function adminSessionConfigIssue(): string | null {
  const secret = process.env.ADMIN_SESSION_SECRET?.trim() ?? "";
  if (!secret || secret === BLOCKED_SESSION_SECRET) {
    return "Set ADMIN_SESSION_SECRET to a unique server-only value.";
  }
  if (secret.length < MIN_SESSION_SECRET_LENGTH) {
    return "ADMIN_SESSION_SECRET must be at least 32 characters.";
  }
  const password = process.env.ADMIN_PASSWORD?.trim() ?? "";
  if (password && secret === password) {
    return "ADMIN_SESSION_SECRET must be different from ADMIN_PASSWORD.";
  }
  return null;
}

function getSessionSecret(): string {
  const issue = adminSessionConfigIssue();
  if (issue) throw new AdminSessionConfigError(issue);
  return process.env.ADMIN_SESSION_SECRET!.trim();
}

/** @deprecated Use getAdminUsername() — kept for any residual imports. */
export const ADMIN_USERNAME = getAdminUsername();

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
  if (!value || adminSessionConfigIssue()) return null;

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
