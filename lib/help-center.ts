/** Shared Help Center validation helpers (schema-aligned). */

export const HELP_LOCALES = ["en", "hi", "gu"] as const;
export type HelpLocale = (typeof HELP_LOCALES)[number];

export const FAQ_STATUSES = ["draft", "published"] as const;
export type FaqStatus = (typeof FAQ_STATUSES)[number];

/** Category key acts as the stable slug (column: help_faq_categories.key). */
const CATEGORY_KEY_RE = /^[a-z][a-z0-9_]{1,62}$/;

export function isHelpLocale(value: unknown): value is HelpLocale {
  return typeof value === "string" && (HELP_LOCALES as readonly string[]).includes(value);
}

export function isFaqStatus(value: unknown): value is FaqStatus {
  return typeof value === "string" && (FAQ_STATUSES as readonly string[]).includes(value);
}

export function normalizeCategoryKey(raw: unknown): {
  ok: true;
  value: string;
} | { ok: false; error: string } {
  if (typeof raw !== "string") {
    return { ok: false, error: "Category key is required." };
  }
  const value = raw.trim().toLowerCase();
  if (!CATEGORY_KEY_RE.test(value)) {
    return {
      ok: false,
      error:
        "Key must be 2–63 chars: start with a letter, then lowercase letters, digits, or underscores.",
    };
  }
  return { ok: true, value };
}

export function parseSortOrder(raw: unknown, fallback = 0): {
  ok: true;
  value: number;
} | { ok: false; error: string } {
  if (raw === undefined || raw === null || raw === "") {
    return { ok: true, value: fallback };
  }
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 1_000_000) {
    return { ok: false, error: "Sort order must be an integer between 0 and 1000000." };
  }
  return { ok: true, value: n };
}

export function parseKeywords(raw: unknown): {
  ok: true;
  value: string[];
} | { ok: false; error: string } {
  if (raw === undefined || raw === null || raw === "") {
    return { ok: true, value: [] };
  }
  let list: string[] = [];
  if (Array.isArray(raw)) {
    list = raw.map((v) => String(v));
  } else if (typeof raw === "string") {
    list = raw.split(/[,;\n]/);
  } else {
    return { ok: false, error: "Keywords must be a string or array." };
  }
  const cleaned = [
    ...new Set(
      list
        .map((k) => k.trim().toLowerCase())
        .filter((k) => k.length > 0)
        .slice(0, 40),
    ),
  ];
  if (cleaned.some((k) => k.length > 64)) {
    return { ok: false, error: "Each keyword must be at most 64 characters." };
  }
  return { ok: true, value: cleaned };
}

export function validateTranslationText(
  field: "question" | "answer",
  raw: unknown,
): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof raw !== "string") {
    return { ok: false, error: `${field} is required.` };
  }
  const value = raw.trim();
  if (!value) {
    return { ok: false, error: `${field} cannot be empty.` };
  }
  const max = field === "question" ? 500 : 20000;
  if (value.length > max) {
    return { ok: false, error: `${field} is too long (max ${max} characters).` };
  }
  return { ok: true, value };
}

export function parseBool(raw: unknown, fallback: boolean): boolean {
  if (typeof raw === "boolean") return raw;
  if (raw === "true" || raw === 1 || raw === "1") return true;
  if (raw === "false" || raw === 0 || raw === "0") return false;
  return fallback;
}

/** AI settings hard ceilings from DB CHECKs. */
export const AI_SETTING_LIMITS = {
  weekly_allowance_seconds: { min: 1, max: 600 },
  max_session_seconds: { min: 1, max: 120 },
  lease_seconds: { min: 15, max: 30 },
} as const;

export function parseBoundedInt(
  raw: unknown,
  field: keyof typeof AI_SETTING_LIMITS,
): { ok: true; value: number } | { ok: false; error: string } {
  const limits = AI_SETTING_LIMITS[field];
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    return { ok: false, error: `${field} must be an integer.` };
  }
  if (n < limits.min || n > limits.max) {
    return {
      ok: false,
      error: `${field} must be between ${limits.min} and ${limits.max}.`,
    };
  }
  return { ok: true, value: n };
}
