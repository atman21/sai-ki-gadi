/**
 * Pure helpers for SKG AI Admin Dashboard metrics (Phase 2B).
 * Aligns with T29 tables: skg_ai_settings, skg_ai_voice_sessions,
 * help_faq_categories, help_faqs. No invented sources.
 */

import {
  AI_MANAGEMENT_NAV_ITEMS,
  type AiManagementTabKey,
} from "@/lib/ai-management-nav";
import type { AdminPermission } from "@/lib/admin-permissions";

export const AI_DASHBOARD_TIMEZONE = "Asia/Kolkata";

export type VoiceSessionStatus =
  | "reserved"
  | "active"
  | "ended"
  | "expired"
  | "failed";

export type MetricAvailability = "available" | "unavailable" | "forbidden";

export type CountMetric = {
  availability: MetricAvailability;
  value: number | null;
  label?: string;
};

export function emptyUnavailable(label = "Data unavailable"): CountMetric {
  return { availability: "unavailable", value: null, label };
}

export function emptyForbidden(label = "Permission required"): CountMetric {
  return { availability: "forbidden", value: null, label };
}

export function countMetric(value: number): CountMetric {
  return { availability: "available", value };
}

/** Asia/Kolkata calendar date key YYYY-MM-DD */
export function kolkataDateKey(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: AI_DASHBOARD_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * Approximate UTC instant for start of Kolkata calendar day (IST = UTC+5:30).
 * Sufficient for Admin dashboard range filters.
 */
export function kolkataDayStartUtcIso(dateKey: string): string {
  return `${dateKey}T00:00:00.000+05:30`;
}

export function kolkataMonthStartUtcIso(dateKey: string): string {
  const monthKey = `${dateKey.slice(0, 7)}-01`;
  return kolkataDayStartUtcIso(monthKey);
}

export function deriveVoiceAvailability(input: {
  voice_enabled: boolean;
  emergency_disabled: boolean;
  voice_connectivity_verified_at: string | null;
}): {
  available: boolean;
  label: string;
} {
  if (input.emergency_disabled) {
    return { available: false, label: "Emergency disabled" };
  }
  if (!input.voice_connectivity_verified_at) {
    return { available: false, label: "Connectivity not verified" };
  }
  if (!input.voice_enabled) {
    return { available: false, label: "Voice disabled" };
  }
  return { available: true, label: "Available" };
}

export function deriveHelpCenterAvailability(input: {
  help_center_enabled: boolean;
  emergency_disabled: boolean;
}): { available: boolean; label: string } {
  if (input.emergency_disabled) {
    return { available: false, label: "Emergency disabled" };
  }
  if (!input.help_center_enabled) {
    return { available: false, label: "Help Center disabled" };
  }
  return { available: true, label: "Enabled" };
}

export function deriveOverallAiStatus(input: {
  help_center_enabled: boolean;
  voice_enabled: boolean;
  emergency_disabled: boolean;
  voice_connectivity_verified_at: string | null;
}): { status: "enabled" | "partial" | "disabled"; label: string } {
  if (input.emergency_disabled) {
    return { status: "disabled", label: "Emergency stop active" };
  }
  const voice = deriveVoiceAvailability(input);
  const help = deriveHelpCenterAvailability(input);
  if (help.available && voice.available) {
    return { status: "enabled", label: "Help Center + Voice available" };
  }
  if (help.available || voice.available) {
    return { status: "partial", label: "Partially available" };
  }
  return { status: "disabled", label: "Services unavailable" };
}

/**
 * Connectivity is inferred only from stored verification timestamp.
 * Dashboard does not invoke the Gemini connectivity Edge Function.
 */
export function deriveConnectivityStatus(
  voice_connectivity_verified_at: string | null,
): {
  status: "verified" | "not_verified";
  label: string;
  verified_at: string | null;
} {
  if (!voice_connectivity_verified_at) {
    return {
      status: "not_verified",
      label: "Not verified",
      verified_at: null,
    };
  }
  return {
    status: "verified",
    label: "Verification recorded",
    verified_at: voice_connectivity_verified_at,
  };
}

export function sumSettledSeconds(
  rows: Array<{ settled_seconds?: number | null }>,
): number {
  let total = 0;
  for (const row of rows) {
    const n = Number(row.settled_seconds ?? 0);
    if (Number.isFinite(n) && n > 0) total += n;
  }
  return total;
}

export function countBySessionStatus(
  rows: Array<{ status?: string | null }>,
): Record<VoiceSessionStatus, number> {
  const out: Record<VoiceSessionStatus, number> = {
    reserved: 0,
    active: 0,
    ended: 0,
    expired: 0,
    failed: 0,
  };
  for (const row of rows) {
    const status = row.status;
    if (
      status === "reserved" ||
      status === "active" ||
      status === "ended" ||
      status === "expired" ||
      status === "failed"
    ) {
      out[status] += 1;
    }
  }
  return out;
}

export function formatSessionActivityLabel(input: {
  status: string;
  end_reason?: string | null;
}): string {
  const reason = (input.end_reason ?? "").trim();
  if (reason) return `Voice session ${input.status} (${reason})`;
  return `Voice session ${input.status}`;
}

export function sanitizeAuditActivity(input: {
  created_at: string | null;
  action: string | null;
  description: string | null;
  success: boolean | null;
  outcome?: string | null;
}): {
  at: string | null;
  event: string;
  status: string;
} {
  const action = (input.action ?? "").trim() || "activity";
  const description = (input.description ?? "").trim();
  // Prefer short action key; avoid dumping large descriptions with content.
  const event =
    description && description.length <= 120 ? description : action;
  let status = "unknown";
  if (input.success === true) status = "success";
  else if (input.success === false) status = "failure";
  else if (input.outcome) status = String(input.outcome);
  return { at: input.created_at, event, status };
}

export function dashboardQuickLinks(
  hasPermission: (permission: AdminPermission) => boolean,
): Array<{ key: AiManagementTabKey; label: string; href: string }> {
  return AI_MANAGEMENT_NAV_ITEMS.filter(
    (item) => item.key !== "ai-dashboard" && hasPermission(item.viewPermission),
  ).map((item) => ({
    key: item.key,
    label: item.label,
    href: `/dashboard?tab=${item.key}`,
  }));
}
