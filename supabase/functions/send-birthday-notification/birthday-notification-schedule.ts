/**
 * One combined birthday digest per Asia/Kolkata date.
 * Shared by the edge function and node tests.
 * Feb 29 rules match lib/birthday-utils.ts.
 * FCM token shape matches lib/push-recipient-filter.ts.
 */

export const BIRTHDAY_TIMEZONE = "Asia/Kolkata";
export const BIRTHDAY_STALE_PENDING_MS = 15 * 60 * 1000;
export const BIRTHDAY_SCHEDULED_KEY = "scheduled";
export const BIRTHDAY_NAME_PREVIEW_LIMIT = 5;
export const BIRTHDAY_FCM_CHUNK = 25;
export const DIGEST_STATUS_WRITE_ATTEMPTS = 3;
export const BIRTHDAY_DIGEST_TITLE = "🎂 Birthday Wishes!";

/**
 * Live production project. Confirmed in the S0-2 production release gate.
 * Delivery is refused for this ref even if the staging flag is set.
 */
export const PRODUCTION_SUPABASE_PROJECT_REF = "uecdmytikvwiosnyndxe";

/**
 * Hosted non-production projects the birthday sender may use.
 * Loopback (local Supabase on 127.0.0.1 / localhost) is also allowlisted.
 */
export const STAGING_SUPABASE_PROJECT_REF = "lhzgfhbnfbztwnowxxoy";
/** Mobile V2 Staging project ref (sai-ki-gadi-app EXPO staging). */
export const MOBILE_STAGING_SUPABASE_PROJECT_REF = "mnbwcwaxfywwkaxiwndo";

export const ALLOWED_BIRTHDAY_PROJECT_REFS = new Set([
  STAGING_SUPABASE_PROJECT_REF,
  MOBILE_STAGING_SUPABASE_PROJECT_REF,
  "local-staging",
]);

export type KolkataClock = {
  dateKey: string;
  hhmm: string;
  minutes: number;
};

export type DigestStatus = "pending" | "success" | "partial" | "failure";

export type DigestSnapshot = {
  status: DigestStatus;
  lockedAtMs: number | null;
  body: string | null;
};

export type BirthdayPerson = {
  id: string;
  firstName: string | null;
  lastName: string | null;
};

export type TokenTarget = {
  hash: string;
  userId: string;
};

export type DeviceOutcome = {
  hash: string;
  status: "success" | "failure" | "unrecorded";
};

export type DigestDecision =
  | {
      action: "skip";
      reason: "no_birthdays" | "before_send_time" | "already_sent" | "in_flight";
    }
  | { action: "finalize" }
  | { action: "send"; mode: "insert" | "reclaim" };

export function getKolkataClock(date = new Date()): KolkataClock {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: BIRTHDAY_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "00";

  const year = get("year");
  const month = get("month");
  const day = get("day");
  let hour = get("hour");
  const minute = get("minute");
  if (hour === "24") hour = "00";

  const minutes = Number(hour) * 60 + Number(minute);
  return {
    dateKey: `${year}-${month}-${day}`,
    hhmm: `${hour}:${minute}`,
    minutes,
  };
}

export function minutesOfDay(hhmm: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour > 23 ||
    minute > 59
  ) {
    return null;
  }
  return hour * 60 + minute;
}

export function normalizeSendTime(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const minutes = minutesOfDay(raw);
  if (minutes === null) return null;
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function isSendTimeReached(nowMinutes: number, sendTime: string): boolean {
  const start = minutesOfDay(sendTime);
  if (start === null) return false;
  return nowMinutes >= start;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function parseDateKey(
  value: string,
): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim().slice(0, 10));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }
  return { year, month, day };
}

export function isBirthdayOnKolkataDate(
  birthDate: string | null | undefined,
  kolkataDateKey: string,
): boolean {
  if (!birthDate || typeof birthDate !== "string") return false;
  const birth = parseDateKey(birthDate);
  const today = parseDateKey(kolkataDateKey);
  if (!birth || !today) return false;

  if (birth.month === 2 && birth.day === 29) {
    if (today.month === 2 && today.day === 29) return true;
    if (today.month === 3 && today.day === 1 && !isLeapYear(today.year)) {
      return true;
    }
    return false;
  }

  return today.month === birth.month && today.day === birth.day;
}

export function birthdayPersonName(person: BirthdayPerson): string {
  const name = [person.firstName, person.lastName]
    .filter((value) => typeof value === "string" && value.trim())
    .join(" ")
    .trim();
  return name || "Member";
}

export function orderedBirthdayNames(people: BirthdayPerson[]): string[] {
  return [...people]
    .sort((a, b) => {
      const byName = birthdayPersonName(a).localeCompare(birthdayPersonName(b));
      if (byName !== 0) return byName;
      return a.id.localeCompare(b.id);
    })
    .map(birthdayPersonName);
}

/** Null when there is nobody to announce. One body for the whole IST day. */
export function formatBirthdayDigestBody(names: string[]): string | null {
  const clean = names.map((name) => name.trim()).filter(Boolean);
  if (clean.length === 0) return null;
  if (clean.length === 1) {
    return `Today is ${clean[0]}'s birthday! Wish them a very Happy Birthday!`;
  }

  const preview = clean.slice(0, BIRTHDAY_NAME_PREVIEW_LIMIT);
  const extra = clean.length - preview.length;
  let list: string;
  if (extra > 0) {
    const noun = extra === 1 ? "other" : "others";
    list = `${preview.join(", ")} and ${extra} ${noun}`;
  } else if (preview.length === 2) {
    list = `${preview[0]} and ${preview[1]}`;
  } else {
    list = `${preview.slice(0, -1).join(", ")} and ${preview[preview.length - 1]}`;
  }
  return `Birthdays today: ${list}. Wish them a very Happy Birthday!`;
}

export function supabaseProjectRef(url: string | undefined): string | null {
  if (!url || typeof url !== "string") return null;
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === "127.0.0.1" || host === "localhost") return "local-staging";
    const match = /^([a-z0-9]+)\.supabase\.co$/.exec(host);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export function parseTestTokenAllowlist(raw: string | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const token = part.trim();
    if (!isBirthdayFcmToken(token) || seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

/**
 * Delivery modes:
 * - unset / other → disabled (safe default; no FCM)
 * - staging → non-prod allowlisted project + BIRTHDAY_PUSH_TEST_TOKENS only
 * - enabled → non-prod allowlisted project + all registered FCM tokens
 * Production project ref is refused unconditionally.
 */
export function evaluateBirthdayDeliveryGate(input: {
  deliveryFlag: string | undefined;
  supabaseUrl: string | undefined;
  testTokens: string[];
}):
  | { allowed: true; projectRef: string; mode: "staging" | "enabled" }
  | { allowed: false; reason: string } {
  const flag = (input.deliveryFlag ?? "").trim().toLowerCase();
  if (flag !== "staging" && flag !== "enabled") {
    return { allowed: false, reason: "delivery_disabled" };
  }
  const projectRef = supabaseProjectRef(input.supabaseUrl);
  if (!projectRef) return { allowed: false, reason: "unknown_project" };
  if (projectRef === PRODUCTION_SUPABASE_PROJECT_REF) {
    return { allowed: false, reason: "production_project" };
  }
  if (!ALLOWED_BIRTHDAY_PROJECT_REFS.has(projectRef)) {
    return { allowed: false, reason: "project_not_allowlisted" };
  }
  if (flag === "staging" && input.testTokens.length === 0) {
    return { allowed: false, reason: "missing_test_tokens" };
  }
  return { allowed: true, projectRef, mode: flag };
}

export function selectBirthdayPeople(
  people: BirthdayPerson[],
  birthDateById: Readonly<Record<string, string | null | undefined>>,
  kolkataDateKey: string,
): BirthdayPerson[] {
  return people.filter((person) =>
    isBirthdayOnKolkataDate(birthDateById[person.id], kolkataDateKey),
  );
}

/** Every valid device, including devices owned by someone whose birthday it is. */
export function selectProductRecipients(tokens: TokenTarget[]): TokenTarget[] {
  const seen = new Set<string>();
  const out: TokenTarget[] = [];
  for (const token of tokens) {
    if (!token.hash || seen.has(token.hash)) continue;
    seen.add(token.hash);
    out.push(token);
  }
  return out;
}

export function restrictToTestAllowlist(
  tokens: TokenTarget[],
  allowlistHashes: ReadonlySet<string>,
): TokenTarget[] {
  return tokens.filter((token) => allowlistHashes.has(token.hash));
}

export function pendingTokenTargets(
  tokens: TokenTarget[],
  succeededHashes: ReadonlySet<string>,
): TokenTarget[] {
  return tokens.filter((token) => !succeededHashes.has(token.hash));
}

export function decideDigestAttempt(input: {
  birthdayCount: number;
  nowMinutes: number;
  sendTime: string;
  existing: DigestSnapshot | null;
  nowMs: number;
  undeliveredCount: number;
  deliveredCount: number;
  stalePendingMs?: number;
}): DigestDecision {
  const stalePendingMs = input.stalePendingMs ?? BIRTHDAY_STALE_PENDING_MS;
  if (input.birthdayCount <= 0) {
    return { action: "skip", reason: "no_birthdays" };
  }

  const existing = input.existing;
  if (existing?.status === "success") {
    return { action: "skip", reason: "already_sent" };
  }

  if (existing?.status === "pending") {
    const age =
      existing.lockedAtMs == null ? null : input.nowMs - existing.lockedAtMs;
    if (age == null || age <= stalePendingMs) {
      return { action: "skip", reason: "in_flight" };
    }
  }

  if (!existing && !isSendTimeReached(input.nowMinutes, input.sendTime)) {
    return { action: "skip", reason: "before_send_time" };
  }

  if (input.undeliveredCount === 0 && input.deliveredCount > 0) {
    return { action: "finalize" };
  }

  return { action: "send", mode: existing ? "reclaim" : "insert" };
}

/**
 * One isolated device failure must not erase successes.
 * An FCM success whose row was not persisted stays unrecorded and is retried
 * only after the status write itself is retried.
 */
export function summarizeDeliveryAttempt(input: {
  targets: string[];
  outcomes: DeviceOutcome[];
}): {
  status: DigestStatus;
  succeeded: string[];
  failed: string[];
  unrecorded: string[];
} {
  const byHash = new Map<string, DeviceOutcome["status"]>();
  for (const outcome of input.outcomes) {
    byHash.set(outcome.hash, outcome.status);
  }

  const succeeded: string[] = [];
  const failed: string[] = [];
  const unrecorded: string[] = [];
  for (const hash of input.targets) {
    const status = byHash.get(hash) ?? "unrecorded";
    if (status === "success") succeeded.push(hash);
    else if (status === "failure") failed.push(hash);
    else unrecorded.push(hash);
  }

  let status: DigestStatus = "failure";
  if (succeeded.length === input.targets.length && input.targets.length > 0) {
    status = "success";
  } else if (succeeded.length > 0 || unrecorded.length > 0) {
    status = "partial";
  }

  return { status, succeeded, failed, unrecorded };
}

export function isBirthdayFcmToken(token: unknown): boolean {
  if (typeof token !== "string") return false;
  const value = token.trim();
  if (value.length < 80 || value.length > 4096) return false;
  if (/^ExponentPushToken\[/i.test(value)) return false;
  if (/^https?:\/\//i.test(value)) return false;
  if (/\s|"|'/.test(value)) return false;
  return /^[A-Za-z0-9_\-:]+$/.test(value);
}

export function maskPushToken(token: string): string {
  if (token.length <= 12) return "***";
  return `${token.slice(0, 8)}…${token.slice(-4)}`;
}

export function isPermanentFcmTokenError(
  errorCode?: string,
  message?: string,
): boolean {
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
