/**
 * SKG AI Knowledge Base Admin helpers (Phase 3B).
 * Aligns with migration 20261116190000_skg_ai_knowledge_phase3b.sql.
 * Distinct from Help FAQ (help_faq_*). Not injected into Gemini Live yet.
 */

export const AI_KNOWLEDGE_LOCALES = ["en", "hi", "gu"] as const;
export type AiKnowledgeLocale = (typeof AI_KNOWLEDGE_LOCALES)[number];

export const AI_KNOWLEDGE_STATUSES = [
  "draft",
  "pending_review",
  "approved",
  "published",
  "rejected",
  "archived",
] as const;
export type AiKnowledgeStatus = (typeof AI_KNOWLEDGE_STATUSES)[number];

export const AI_KNOWLEDGE_CATEGORY_SEEDS = [
  { key: "membership", label: "Membership" },
  { key: "trip_points", label: "Trip Points" },
  { key: "bookings", label: "Bookings" },
  { key: "payments", label: "Payments" },
  { key: "lucky_draw", label: "Lucky Draw" },
  { key: "driver_services", label: "Driver Services" },
  { key: "exchange", label: "Exchange" },
  { key: "help_center", label: "Help Center" },
  { key: "profile", label: "Profile" },
  { key: "otp_login", label: "OTP / Login" },
  { key: "general_app", label: "General SKG App Information" },
] as const;

export const GEMINI_KNOWLEDGE_RETRIEVAL = {
  wired: false as const,
  eligible_status: "published" as const,
  note:
    "Only status=published articles (with approved_at) are eligible for future Gemini retrieval. Drafts, pending_review, approved-only, rejected, and archived must never be exposed to Mobile JWT or Live mint until a separate retrieval integration is built.",
} as const;

const MAX_TITLE = 300;
const MAX_BODY = 20000;
const MAX_KEYWORDS = 40;
const MAX_KEYWORD_LEN = 64;

export function isAiKnowledgeLocale(
  value: unknown,
): value is AiKnowledgeLocale {
  return (
    typeof value === "string" &&
    (AI_KNOWLEDGE_LOCALES as readonly string[]).includes(value)
  );
}

export function isAiKnowledgeStatus(
  value: unknown,
): value is AiKnowledgeStatus {
  return (
    typeof value === "string" &&
    (AI_KNOWLEDGE_STATUSES as readonly string[]).includes(value)
  );
}

export function normalizeKnowledgeText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\r\n/g, "\n").trim() : "";
}

export function parseKnowledgeKeywords(
  value: unknown,
): { ok: true; keywords: string[] } | { ok: false; error: string } {
  if (value == null) return { ok: true, keywords: [] };
  let items: unknown[] = [];
  if (Array.isArray(value)) items = value;
  else if (typeof value === "string") {
    items = value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
  } else {
    return { ok: false, error: "keywords must be an array or comma-separated string." };
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const text = normalizeKnowledgeText(item).toLowerCase();
    if (!text || seen.has(text)) continue;
    if (text.length > MAX_KEYWORD_LEN) {
      return { ok: false, error: `Keyword exceeds ${MAX_KEYWORD_LEN} characters.` };
    }
    seen.add(text);
    out.push(text);
    if (out.length > MAX_KEYWORDS) {
      return { ok: false, error: `At most ${MAX_KEYWORDS} keywords allowed.` };
    }
  }
  return { ok: true, keywords: out };
}

export type KnowledgeTranslationInput = {
  locale: AiKnowledgeLocale;
  title: string;
  body: string;
};

export function parseKnowledgeTranslations(
  value: unknown,
):
  | { ok: true; translations: KnowledgeTranslationInput[] }
  | { ok: false; error: string } {
  if (value == null) return { ok: true, translations: [] };
  if (!Array.isArray(value)) {
    return { ok: false, error: "translations must be an array." };
  }
  const out: KnowledgeTranslationInput[] = [];
  const seen = new Set<string>();
  for (const row of value) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      return { ok: false, error: "Each translation must be an object." };
    }
    const locale = (row as { locale?: unknown }).locale;
    if (!isAiKnowledgeLocale(locale)) {
      return { ok: false, error: "locale must be one of: en, hi, gu." };
    }
    if (seen.has(locale)) {
      return { ok: false, error: `Duplicate translation for locale ${locale}.` };
    }
    const title = normalizeKnowledgeText((row as { title?: unknown }).title);
    const body = normalizeKnowledgeText((row as { body?: unknown }).body);
    if (!title || !body) {
      return {
        ok: false,
        error: `Title and body are required for locale ${locale}.`,
      };
    }
    if (title.length > MAX_TITLE || body.length > MAX_BODY) {
      return {
        ok: false,
        error: `Translation for ${locale} exceeds allowed length.`,
      };
    }
    const combined = `${title}\n${body}`;
    if (
      /GEMINI_API_KEY|SUPABASE_SERVICE_ROLE|BEGIN PRIVATE KEY|sk-[a-zA-Z0-9]{20,}/i.test(
        combined,
      )
    ) {
      return {
        ok: false,
        error: "Knowledge text must not contain secrets or API keys.",
      };
    }
    seen.add(locale);
    out.push({ locale, title, body });
  }
  return { ok: true, translations: out };
}

export function hasEnglishTranslation(
  locales: string[] | KnowledgeTranslationInput[],
): boolean {
  if (locales.length === 0) return false;
  if (typeof locales[0] === "string") {
    return (locales as string[]).includes("en");
  }
  return (locales as KnowledgeTranslationInput[]).some((t) => t.locale === "en");
}

export function canEditKnowledgeContent(status: AiKnowledgeStatus): boolean {
  return status === "draft" || status === "rejected";
}

export function canSubmitForReview(status: AiKnowledgeStatus): boolean {
  return status === "draft" || status === "rejected";
}

export function canApprove(status: AiKnowledgeStatus): boolean {
  return status === "pending_review";
}

export function canReject(status: AiKnowledgeStatus): boolean {
  return status === "pending_review";
}

export function canPublish(status: AiKnowledgeStatus): boolean {
  return status === "approved";
}

export function canUnpublish(status: AiKnowledgeStatus): boolean {
  return status === "published";
}

export function canArchive(status: AiKnowledgeStatus): boolean {
  return status !== "archived";
}

/** Metadata-only audit snapshot — omit full article bodies. */
export function knowledgeAuditSnapshot(input: {
  id?: string | null;
  category_id?: string | null;
  status?: string | null;
  version?: number | null;
  sort_order?: number | null;
  keywords?: string[] | null;
  locales?: string[] | null;
  published_at?: string | null;
  approved_at?: string | null;
  title_preview?: string | null;
}): Record<string, unknown> {
  return {
    id: input.id ?? null,
    category_id: input.category_id ?? null,
    status: input.status ?? null,
    version: input.version ?? null,
    sort_order: input.sort_order ?? null,
    keywords: input.keywords ?? [],
    locales: input.locales ?? [],
    published_at: input.published_at ?? null,
    approved_at: input.approved_at ?? null,
    title_preview: (input.title_preview ?? "").slice(0, 80) || null,
  };
}

export function localeLabel(locale: string): string {
  if (locale === "en") return "English";
  if (locale === "hi") return "Hindi";
  if (locale === "gu") return "Gujarati";
  return locale;
}

export function statusLabel(status: string): string {
  switch (status) {
    case "draft":
      return "Draft";
    case "pending_review":
      return "Pending Review";
    case "approved":
      return "Approved";
    case "published":
      return "Published";
    case "rejected":
      return "Rejected";
    case "archived":
      return "Archived";
    default:
      return status;
  }
}

export function isGeminiEligibleKnowledge(status: string): boolean {
  return status === GEMINI_KNOWLEDGE_RETRIEVAL.eligible_status;
}
