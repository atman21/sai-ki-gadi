/**
 * Help FAQ Admin helpers — aligned with Mobile T29 schema
 * (help_faq_categories / help_faqs / help_faq_translations).
 * No version-history table exists in T29; edits update rows in place.
 */

export const HELP_FAQ_LOCALES = ["en", "hi", "gu"] as const;
export type HelpFaqLocale = (typeof HELP_FAQ_LOCALES)[number];

export const HELP_FAQ_STATUSES = ["draft", "published"] as const;
export type HelpFaqStatus = (typeof HELP_FAQ_STATUSES)[number];

export const HELP_FAQ_CATEGORY_LABELS: Record<string, string> = {
  account_registration: "Account & Registration",
  otp_login: "OTP & Login",
  driver_requirements: "Driver Requirements",
  booking_trips: "Booking & Trips",
  payments: "Payments",
  profile_documents: "Profile & Documents",
  app_issues: "App Issues",
};

export function isHelpFaqLocale(value: unknown): value is HelpFaqLocale {
  return (
    typeof value === "string" &&
    (HELP_FAQ_LOCALES as readonly string[]).includes(value)
  );
}

export function isHelpFaqStatus(value: unknown): value is HelpFaqStatus {
  return (
    typeof value === "string" &&
    (HELP_FAQ_STATUSES as readonly string[]).includes(value)
  );
}

export function normalizeFaqText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function parseKeywords(value: unknown): string[] | null {
  if (value == null) return [];
  if (Array.isArray(value)) {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const item of value) {
      const text = normalizeFaqText(item).toLowerCase();
      if (!text || seen.has(text)) continue;
      if (text.length > 64) return null;
      seen.add(text);
      out.push(text);
      if (out.length > 40) return null;
    }
    return out;
  }
  if (typeof value === "string") {
    return parseKeywords(
      value
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean),
    );
  }
  return null;
}

export type FaqTranslationInput = {
  locale: HelpFaqLocale;
  question: string;
  answer: string;
};

/**
 * Parse translation payloads.
 * - Missing/empty array → []
 * - Each provided locale must have non-empty question and answer
 * - Unknown locales rejected
 * - Duplicate locales rejected
 */
export function parseTranslationInputs(
  value: unknown,
): { ok: true; translations: FaqTranslationInput[] } | { ok: false; error: string } {
  if (value == null) return { ok: true, translations: [] };
  if (!Array.isArray(value)) {
    return { ok: false, error: "translations must be an array." };
  }
  const out: FaqTranslationInput[] = [];
  const seen = new Set<string>();
  for (const row of value) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      return { ok: false, error: "Each translation must be an object." };
    }
    const locale = (row as { locale?: unknown }).locale;
    if (!isHelpFaqLocale(locale)) {
      return { ok: false, error: "locale must be one of: en, hi, gu." };
    }
    if (seen.has(locale)) {
      return { ok: false, error: `Duplicate translation for locale ${locale}.` };
    }
    const question = normalizeFaqText((row as { question?: unknown }).question);
    const answer = normalizeFaqText((row as { answer?: unknown }).answer);
    if (!question || !answer) {
      return {
        ok: false,
        error: `Question and answer are required for locale ${locale}.`,
      };
    }
    if (question.length > 500 || answer.length > 8000) {
      return {
        ok: false,
        error: `Translation for ${locale} exceeds allowed length.`,
      };
    }
    seen.add(locale);
    out.push({ locale, question, answer });
  }
  return { ok: true, translations: out };
}

export function categoryLabel(key: string): string {
  return HELP_FAQ_CATEGORY_LABELS[key] ?? key.replace(/_/g, " ");
}

export function localeLabel(locale: HelpFaqLocale): string {
  switch (locale) {
    case "en":
      return "English";
    case "hi":
      return "Hindi";
    case "gu":
      return "Gujarati";
  }
}

/** Audit-safe snapshot — metadata only, no Q&A bodies. */
export function faqAuditSnapshot(input: {
  id?: string;
  category_id?: string | null;
  status?: string | null;
  sort_order?: number | null;
  is_popular?: boolean | null;
  keywords?: string[] | null;
  published_at?: string | null;
  locales?: string[] | null;
}): Record<string, unknown> {
  return {
    id: input.id ?? null,
    category_id: input.category_id ?? null,
    status: input.status ?? null,
    sort_order: input.sort_order ?? null,
    is_popular: input.is_popular ?? null,
    keywords_count: Array.isArray(input.keywords) ? input.keywords.length : 0,
    published_at: input.published_at ?? null,
    locales: input.locales ?? [],
  };
}

export function canPublishFaq(localesPresent: string[]): boolean {
  return localesPresent.includes("en");
}

/**
 * Merge translation updates without dropping omitted locales.
 * `updates` only contains locales that should be upserted.
 */
export function mergeLocalePresence(
  existing: string[],
  updates: HelpFaqLocale[],
): string[] {
  return Array.from(new Set([...existing, ...updates])).sort();
}
