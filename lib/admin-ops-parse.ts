export type AdminTone = "neutral" | "success" | "warning" | "danger" | "info";

export type SafeAdminNotification = {
  id: string;
  type: string;
  title: string;
  message: string;
  user_id: string | null;
  is_read: boolean;
  created_at: string;
};

export type MemberVerificationListItem = {
  id: string;
  userId: string;
  memberName: string;
  mobile: string;
  registeredAt: string | null;
  caseStatus: string;
  caseStatusLabel: string;
  caseTone: AdminTone;
  recommendationLabel: string;
  confidenceLabel: string;
  accountStatusLabel: string;
  accountTone: AdminTone;
  lastActivityAt: string | null;
  needsAttention: boolean;
  attentionLabels: string[];
  shadowNote: string | null;
  decisionNote: string | null;
};

export type MemberVerificationList = {
  items: MemberVerificationListItem[];
  page: number;
  pageSize: number;
  total: number | null;
};

export type VerificationTimelineEvent = {
  key: string;
  label: string;
  at: string;
};

export type MemberVerificationDetail = {
  userId: string;
  memberName: string;
  mobile: string;
  registeredAt: string | null;
  caseStatusLabel: string;
  caseTone: AdminTone;
  recommendationLabel: string;
  confidenceLabel: string;
  accountStatusLabel: string;
  accountTone: AdminTone;
  reasonLabels: string[];
  timeline: VerificationTimelineEvent[];
  needsAttention: boolean;
  attentionLabels: string[];
  shadowNote: string | null;
  decisionNote: string | null;
};

const REASON_LABELS: Record<string, string> = {
  name_requires_review: "Name requires review",
  name_mismatch: "Name requires review",
  dob_mismatch: "Date of birth mismatch",
  date_of_birth_mismatch: "Date of birth mismatch",
  document_image_unclear: "Document image unclear",
  image_unclear: "Document image unclear",
  driving_licence_expired: "Driving Licence expired",
  driving_license_expired: "Driving Licence expired",
  dl_expired: "Driving Licence expired",
  required_document_missing: "Required document missing",
  document_missing: "Required document missing",
  duplicate_identity: "Duplicate identity requires review",
  duplicate_identity_requires_review: "Duplicate identity requires review",
  documents_changed: "Documents changed during verification",
  documents_changed_during_verification: "Documents changed during verification",
  provider_unavailable: "Verification provider unavailable",
  verification_provider_unavailable: "Verification provider unavailable",
};

const CANONICAL_REASONS = new Set(Object.values(REASON_LABELS));

const TIMELINE_DEFS: { key: string; label: string; aliases: string[] }[] = [
  {
    key: "member_registered",
    label: "Member Registered",
    aliases: ["member_registered", "registered", "member_registered_at", "user_created"],
  },
  {
    key: "documents_submitted",
    label: "Documents Submitted",
    aliases: ["documents_submitted", "documents_submitted_at", "submitted"],
  },
  {
    key: "documents_updated",
    label: "Documents Updated",
    aliases: ["documents_updated", "documents_updated_at"],
  },
  {
    key: "ai_verification_queued",
    label: "AI Verification Queued",
    aliases: ["ai_verification_queued", "verification_queued", "queued", "queued_at"],
  },
  {
    key: "ai_verification_started",
    label: "AI Verification Started",
    aliases: [
      "ai_verification_started",
      "verification_started",
      "started",
      "started_at",
    ],
  },
  {
    key: "verification_requeued",
    label: "Verification Re-Queued",
    aliases: [
      "verification_requeued",
      "verification_re_queued",
      "requeued",
      "re_queued",
      "requeued_at",
    ],
  },
  {
    key: "reverification_started",
    label: "Re-Verification Started",
    aliases: [
      "reverification_started",
      "re_verification_started",
      "reverification_started_at",
    ],
  },
  {
    key: "ai_recommendation_generated",
    label: "AI Recommendation Generated",
    aliases: [
      "ai_recommendation_generated",
      "recommendation_generated",
      "recommendation_at",
    ],
  },
  {
    key: "manual_review",
    label: "Manual Review",
    aliases: ["manual_review", "manual_review_at"],
  },
  {
    key: "correction_required",
    label: "Correction Required",
    aliases: ["correction_required", "correction_required_at"],
  },
  {
    key: "approved",
    label: "Approved",
    aliases: ["approved", "approved_at"],
  },
  {
    key: "completed",
    label: "Completed",
    aliases: ["completed", "completed_at"],
  },
];

const TIMELINE_BY_KEY = new Map(
  TIMELINE_DEFS.flatMap((def) => def.aliases.map((alias) => [alias, def] as const)),
);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function isUnsafeDisplayText(value: string): boolean {
  return (
    /https?:\/\//i.test(value) ||
    /supabase\.co\/storage/i.test(value) ||
    /eyJ[a-zA-Z0-9_-]{10,}\./.test(value) ||
    /\bsk-[a-zA-Z0-9]{8,}\b/.test(value) ||
    /service[_-]?role/i.test(value) ||
    /ADMIN_SESSION_SECRET/i.test(value) ||
    /BEGIN [A-Z0-9 ]*KEY/.test(value) ||
    /\b\d{12}\b/.test(value) ||
    /\b\d{4}[\s-]\d{4}[\s-]\d{4}\b/.test(value)
  );
}

function pick(records: Record<string, unknown>[], keys: string[]): unknown {
  for (const record of records) {
    for (const key of keys) {
      if (record[key] !== undefined && record[key] !== null) return record[key];
    }
  }
  return undefined;
}

function relatedRecords(record: Record<string, unknown>): Record<string, unknown>[] {
  const nested = ["user", "member", "case", "verification", "identity", "summary"]
    .map((key) => asRecord(record[key]))
    .filter((item): item is Record<string, unknown> => Boolean(item));
  return [record, ...nested];
}

function cleanName(value: unknown): string {
  const text = readString(value);
  if (!text) return "Member";
  const compact = text.replace(/\s+/g, " ").slice(0, 120);
  if (isUnsafeDisplayText(compact) || /\d{5,}/.test(compact) || /[<>{}[\]`]/.test(compact)) {
    return "Member";
  }
  return compact;
}

function cleanMobile(value: unknown): string {
  const text = readString(value);
  if (!text) return "Hidden";
  const compact = text.replace(/\s+/g, " ").slice(0, 20);
  const digits = compact.replace(/\D/g, "");
  if (!/^[+0-9][0-9\s()-]{5,18}$/.test(compact)) return "Hidden";
  if (digits.length < 8 || digits.length > 15) return "Hidden";
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  if (digits.length === 12) return "Hidden";
  return compact;
}

function parseTimestamp(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value < 1_000_000_000_000 ? value * 1000 : value;
    const date = new Date(ms);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString();
  }
  const text = readString(value);
  if (!text || isUnsafeDisplayText(text)) return null;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function parseVerified(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const token = normalizeToken(value);
    if (token === "true" || token === "verified" || token === "yes") return true;
    if (token === "false" || token === "unverified" || token === "no") return false;
  }
  return null;
}

function accountPresentation(verified: boolean | null): {
  accountStatusLabel: string;
  accountTone: AdminTone;
} {
  if (verified === true) {
    return { accountStatusLabel: "Actual Account Status: Verified", accountTone: "success" };
  }
  if (verified === false) {
    return { accountStatusLabel: "Actual Account Status: Unverified", accountTone: "warning" };
  }
  return { accountStatusLabel: "Actual Account Status: Unknown", accountTone: "neutral" };
}

function recommendationPresentation(value: unknown): {
  token: string | null;
  recommendationLabel: string;
} {
  const text = readString(value);
  if (!text || isUnsafeDisplayText(text)) {
    return { token: null, recommendationLabel: "AI Recommendation: Not available" };
  }
  const token = normalizeToken(text);
  const labels: Record<string, { token: string; label: string }> = {
    approve: { token: "approve", label: "Approve" },
    approved: { token: "approve", label: "Approve" },
    correction_required: { token: "correction_required", label: "Correction Required" },
    manual_review: { token: "manual_review", label: "Manual Review" },
    reject: { token: "reject", label: "Reject" },
    rejected: { token: "reject", label: "Reject" },
    provider_unavailable: { token: "provider_unavailable", label: "Provider Unavailable" },
    queued: { token: "queued", label: "Queued" },
    processing: { token: "processing", label: "Processing" },
    completed: { token: "completed", label: "Completed" },
  };
  const match = labels[token];
  if (!match) {
    return { token: null, recommendationLabel: "AI Recommendation: Not available" };
  }
  return {
    token: match.token,
    recommendationLabel: `AI Recommendation: ${match.label}`,
  };
}

function casePresentation(value: unknown): {
  caseStatus: string;
  caseStatusLabel: string;
  caseTone: AdminTone;
} {
  const text = readString(value);
  const token = text ? normalizeToken(text) : "";
  const labels: Record<string, { label: string; tone: AdminTone }> = {
    queued: { label: "Queued", tone: "info" },
    processing: { label: "Processing", tone: "info" },
    manual_review: { label: "Manual Review", tone: "warning" },
    correction_required: { label: "Correction Required", tone: "warning" },
    completed: { label: "Completed", tone: "neutral" },
    verified: { label: "Verified", tone: "neutral" },
    unverified: { label: "Unverified", tone: "neutral" },
    provider_unavailable: { label: "Provider Unavailable", tone: "danger" },
    approved: { label: "Approved", tone: "neutral" },
  };
  const match = labels[token];
  if (!match) {
    return { caseStatus: "unknown", caseStatusLabel: "Unknown", caseTone: "neutral" };
  }
  return { caseStatus: token, caseStatusLabel: match.label, caseTone: match.tone };
}

function parseConfidence(value: unknown, explicitLow: boolean): {
  confidenceLabel: string;
  low: boolean;
} {
  if (explicitLow) {
    const numeric = formatConfidence(value);
    return { confidenceLabel: numeric ?? "Low", low: true };
  }
  if (typeof value === "string") {
    const token = normalizeToken(value);
    if (token === "low") return { confidenceLabel: "Low", low: true };
    if (token === "medium" || token === "high") {
      const label = token === "medium" ? "Medium" : "High";
      return { confidenceLabel: label, low: false };
    }
  }
  const numeric = formatConfidence(value);
  if (!numeric) return { confidenceLabel: "—", low: false };
  const pct = numeric.endsWith("%") ? Number(numeric.replace("%", "")) : Number.NaN;
  return { confidenceLabel: numeric, low: Number.isFinite(pct) && pct < 60 };
}

function formatConfidence(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const pct = value >= 0 && value <= 1 ? value * 100 : value;
    if (pct < 0 || pct > 100) return null;
    return `${Math.round(pct)}%`;
  }
  const text = readString(value);
  if (!text || isUnsafeDisplayText(text)) return null;
  const match = /^(\d{1,3}(?:\.\d+)?)%?$/.exec(text);
  if (!match) return null;
  const pct = Number(match[1]);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return null;
  return `${Math.round(pct)}%`;
}

function safeReasonLabel(value: unknown): string | null {
  const text = readString(value);
  if (!text) return null;
  const coded = REASON_LABELS[normalizeToken(text)];
  if (coded) return coded;
  const canonical = [...CANONICAL_REASONS].find(
    (label) => label.toLowerCase() === text.toLowerCase(),
  );
  if (canonical) return canonical;
  if (text.length < 3 || text.length > 140) return null;
  if (/[<>{}[\]`]/.test(text) || /\d{5,}/.test(text)) return null;
  if (isUnsafeDisplayText(text)) return null;
  if (/openai|prompt|stack trace|service.role|bearer\s/i.test(text)) return null;
  return text;
}

function collectReasons(records: Record<string, unknown>[]): string[] {
  const raw = pick(records, [
    "reason_labels",
    "reasons",
    "safe_reasons",
    "safe_reason_labels",
    "reasonLabels",
  ]);
  const values = Array.isArray(raw) ? raw : raw !== undefined ? [raw] : [];
  const labels: string[] = [];
  for (const value of values) {
    const label = safeReasonLabel(value);
    if (label && !labels.includes(label)) labels.push(label);
  }
  return labels.slice(0, 12);
}

function attentionFor(input: {
  caseStatus: string;
  recommendationToken: string | null;
  lowConfidence: boolean;
  reasonLabels: string[];
  explicitAttention: boolean;
}): { needsAttention: boolean; attentionLabels: string[] } {
  const labels: string[] = [];
  const tokens = new Set(
    [input.caseStatus, input.recommendationToken ?? ""].filter(Boolean),
  );
  if (tokens.has("manual_review")) labels.push("Manual Review");
  if (tokens.has("correction_required")) labels.push("Correction Required");
  if (
    tokens.has("provider_unavailable") ||
    input.reasonLabels.includes("Verification provider unavailable")
  ) {
    labels.push("Provider Unavailable");
  }
  if (input.lowConfidence) labels.push("Low Confidence");
  if (input.explicitAttention && labels.length === 0) labels.push("Needs review");
  return { needsAttention: labels.length > 0, attentionLabels: labels };
}

function shadowNoteFor(
  recommendationToken: string | null,
  verified: boolean | null,
): string | null {
  if (recommendationToken === "approve" && verified === false) {
    return "AI Recommendation: Approve is not applied. Actual Account Status remains Unverified.";
  }
  return null;
}

function decisionNoteFor(
  recommendationToken: string | null,
  verified: boolean | null,
): string | null {
  if (
    (recommendationToken === "correction_required" ||
      recommendationToken === "reject") &&
    verified !== true
  ) {
    return "This AI recommendation is not a final account decision. Actual Account Status is shown separately.";
  }
  return null;
}

function safeId(value: unknown): string | null {
  const text = readString(value);
  if (!text || !/^[A-Za-z0-9_-]{1,80}$/.test(text)) return null;
  return text;
}

function explicitLow(records: Record<string, unknown>[]): boolean {
  const value = pick(records, ["low_confidence", "lowConfidence", "confidence_band", "confidenceBand"]);
  if (value === true) return true;
  return typeof value === "string" && normalizeToken(value) === "low";
}

export function parseNotificationList(payload: unknown): SafeAdminNotification[] {
  const record = asRecord(payload);
  const rawList = Array.isArray(payload)
    ? payload
    : record
      ? (record.notifications ?? record.items ?? record.data)
      : undefined;
  if (!Array.isArray(rawList)) return [];

  const notifications: SafeAdminNotification[] = [];
  for (const item of rawList) {
    const row = asRecord(item);
    if (!row) continue;
    const id = safeId(row.id);
    const createdAt = parseTimestamp(row.created_at ?? row.createdAt);
    if (!id || !createdAt) continue;
    const title = sanitizeNotificationText(row.title, "Notification");
    const message = sanitizeNotificationText(row.message ?? row.body, "");
    const userId = safeId(row.user_id ?? row.userId);
    const isRead =
      row.is_read === true ||
      row.isRead === true ||
      row.read === true ||
      Boolean(parseTimestamp(row.read_at ?? row.readAt));
    const typeText = readString(row.type);
    const type =
      typeText && !isUnsafeDisplayText(typeText)
        ? normalizeToken(typeText).slice(0, 40)
        : "notice";
    notifications.push({
      id,
      type,
      title,
      message,
      user_id: userId,
      is_read: isRead,
      created_at: createdAt,
    });
  }
  return notifications.slice(0, 50);
}

function sanitizeNotificationText(value: unknown, fallback: string): string {
  const text = readString(value);
  if (!text || isUnsafeDisplayText(text) || /[<>{}]/.test(text)) return fallback;
  return text.replace(/\s+/g, " ").slice(0, 500);
}

export function parseUnreadCount(payload: unknown, fallback: number): number {
  const record = asRecord(payload);
  const raw = record
    ? (record.unread_count ?? record.unreadCount ?? record.count)
    : payload;
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(value) || value < 0) return fallback;
  return Math.min(Math.round(value), 100000);
}

function parseMemberRecord(record: Record<string, unknown>): MemberVerificationListItem | null {
  const records = relatedRecords(record);
  const userId =
    safeId(pick(records, ["user_id", "userId"])) ??
    safeId(pick(records, ["id"]));
  if (!userId) return null;
  const caseId = safeId(pick(records, ["case_id", "caseId"])) ?? userId;
  const verified = parseVerified(
    pick(records, ["users_verified", "usersVerified", "verified"]),
  );
  const recommendation = recommendationPresentation(
    pick(records, [
      "recommendation",
      "ai_recommendation",
      "aiRecommendation",
    ]),
  );
  const caseStatus = casePresentation(
    pick(records, ["status", "case_status", "caseStatus", "verification_status"]),
  );
  const confidence = parseConfidence(
    pick(records, ["confidence", "ai_confidence", "aiConfidence"]),
    explicitLow(records),
  );
  const reasonLabels = collectReasons(records);
  const attention = attentionFor({
    caseStatus: caseStatus.caseStatus,
    recommendationToken: recommendation.token,
    lowConfidence: confidence.low,
    reasonLabels,
    explicitAttention: pick(records, ["needs_attention", "needsAttention"]) === true,
  });
  const account = accountPresentation(verified);
  return {
    id: caseId,
    userId,
    memberName: cleanName(
      pick(records, ["member_name", "memberName", "full_name", "fullName", "name"]),
    ),
    mobile: cleanMobile(pick(records, ["mobile", "mobile_number", "phone", "phone_number"])),
    registeredAt: parseTimestamp(
      pick(records, ["registered_at", "registeredAt", "registration_at", "created_at", "createdAt"]),
    ),
    caseStatus: caseStatus.caseStatus,
    caseStatusLabel: caseStatus.caseStatusLabel,
    caseTone: caseStatus.caseTone,
    recommendationLabel: recommendation.recommendationLabel,
    confidenceLabel: confidence.confidenceLabel,
    accountStatusLabel: account.accountStatusLabel,
    accountTone: account.accountTone,
    lastActivityAt: parseTimestamp(
      pick(records, [
        "last_activity_at",
        "lastActivityAt",
        "last_verification_activity_at",
        "updated_at",
        "updatedAt",
      ]),
    ),
    needsAttention: attention.needsAttention,
    attentionLabels: attention.attentionLabels,
    shadowNote: shadowNoteFor(recommendation.token, verified),
    decisionNote: decisionNoteFor(recommendation.token, verified),
  };
}

export function parseMemberVerificationList(
  payload: unknown,
  page: number,
  pageSize: number,
): MemberVerificationList {
  const record = asRecord(payload);
  const data = asRecord(record?.data) ?? record;
  const rawList = Array.isArray(payload)
    ? payload
    : (data?.items ?? data?.members ?? data?.cases ?? data?.results);
  const items: MemberVerificationListItem[] = [];
  if (Array.isArray(rawList)) {
    for (const item of rawList) {
      const row = asRecord(item);
      if (!row) continue;
      const parsed = parseMemberRecord(row);
      if (parsed) items.push(parsed);
    }
  }
  const totalRaw = data?.total ?? data?.total_count ?? data?.totalCount;
  const total =
    typeof totalRaw === "number" && Number.isFinite(totalRaw) && totalRaw >= 0
      ? Math.round(totalRaw)
      : null;
  return {
    items: items.slice(0, pageSize),
    page,
    pageSize,
    total,
  };
}

function timelineFromPayload(records: Record<string, unknown>[]): VerificationTimelineEvent[] {
  const found = new Map<string, string>();
  const remember = (key: string, at: string | null) => {
    if (!at || found.has(key)) return;
    const def = TIMELINE_DEFS.find((item) => item.key === key);
    if (!def) return;
    found.set(key, at);
  };

  const rawEvents = pick(records, ["timeline", "events", "history", "activity"]);
  if (Array.isArray(rawEvents)) {
    for (const item of rawEvents) {
      const row = asRecord(item);
      if (!row) continue;
      const token = readString(row.event ?? row.key ?? row.type ?? row.name ?? row.label);
      if (!token) continue;
      const def = TIMELINE_BY_KEY.get(normalizeToken(token));
      if (!def) continue;
      remember(def.key, parseTimestamp(row.at ?? row.timestamp ?? row.occurred_at ?? row.created_at));
    }
  } else {
    const map = asRecord(rawEvents);
    if (map) {
      for (const [key, value] of Object.entries(map)) {
        const def = TIMELINE_BY_KEY.get(normalizeToken(key));
        if (!def) continue;
        remember(def.key, parseTimestamp(value));
      }
    }
  }

  for (const def of TIMELINE_DEFS) {
    if (found.has(def.key)) continue;
    for (const alias of def.aliases) {
      const value = pick(records, [alias, `${alias}_at`]);
      const at = parseTimestamp(value);
      if (at) {
        remember(def.key, at);
        break;
      }
    }
  }

  return TIMELINE_DEFS.filter((def) => found.has(def.key)).map((def) => ({
    key: def.key,
    label: def.label,
    at: found.get(def.key) as string,
  }));
}

export function parseMemberVerificationDetail(payload: unknown): MemberVerificationDetail | null {
  const record = asRecord(payload);
  if (!record) return null;
  const data = asRecord(record.data) ?? record;
  const parsed = parseMemberRecord(data);
  if (!parsed) return null;
  const records = relatedRecords(data);
  if (record !== data) records.unshift(record);
  return {
    userId: parsed.userId,
    memberName: parsed.memberName,
    mobile: parsed.mobile,
    registeredAt: parsed.registeredAt,
    caseStatusLabel: parsed.caseStatusLabel,
    caseTone: parsed.caseTone,
    recommendationLabel: parsed.recommendationLabel,
    confidenceLabel: parsed.confidenceLabel,
    accountStatusLabel: parsed.accountStatusLabel,
    accountTone: parsed.accountTone,
    reasonLabels: collectReasons(records),
    timeline: timelineFromPayload(records),
    needsAttention: parsed.needsAttention,
    attentionLabels: parsed.attentionLabels,
    shadowNote: parsed.shadowNote,
    decisionNote: parsed.decisionNote,
  };
}

export const MEMBER_VERIFICATION_FILTERS = [
  "all",
  "queued",
  "processing",
  "manual_review",
  "correction_required",
  "completed",
  "verified",
  "unverified",
] as const;

export type MemberVerificationFilter = (typeof MEMBER_VERIFICATION_FILTERS)[number];

export function parseMemberVerificationFilter(value: string | null): MemberVerificationFilter {
  if (value && (MEMBER_VERIFICATION_FILTERS as readonly string[]).includes(value)) {
    return value as MemberVerificationFilter;
  }
  return "all";
}
