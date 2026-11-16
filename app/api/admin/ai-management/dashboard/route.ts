import { NextResponse } from "next/server";

import {
  requireAdminPermission,
  safeErrorMessage,
} from "@/lib/admin-api";
import { actorHasPermission } from "@/lib/admin-rbac";
import {
  countMetric,
  dashboardQuickLinks,
  deriveConnectivityStatus,
  deriveHelpCenterAvailability,
  deriveOverallAiStatus,
  deriveVoiceAvailability,
  emptyForbidden,
  emptyUnavailable,
  formatSessionActivityLabel,
  kolkataDateKey,
  kolkataDayStartUtcIso,
  kolkataMonthStartUtcIso,
  sanitizeAuditActivity,
  sumSettledSeconds,
  type CountMetric,
} from "@/lib/ai-dashboard-metrics";
import { supabaseAdmin } from "@/lib/supabase-admin";

function isMissingRelation(error: { message?: string; code?: string } | null) {
  if (!error) return false;
  const message = (error.message ?? "").toLowerCase();
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    message.includes("does not exist") ||
    message.includes("could not find the table")
  );
}

type HeadCountResult =
  | { ok: true; count: number }
  | { ok: false; missing: boolean; error: string };

/** PostgREST filter builder used only for head counts (eq / gte). */
type CountBuilder = {
  eq: (column: string, value: unknown) => CountBuilder;
  gte: (column: string, value: unknown) => CountBuilder;
} & PromiseLike<{
  count: number | null;
  error: { message?: string; code?: string } | null;
}>;

async function headCount(
  supabase: typeof supabaseAdmin,
  table: string,
  apply?: (query: CountBuilder) => CountBuilder,
): Promise<HeadCountResult> {
  const base = supabase
    .from(table)
    .select("id", { count: "exact", head: true }) as unknown as CountBuilder;
  const query = apply ? apply(base) : base;
  const { count, error } = await query;
  if (error) {
    return {
      ok: false,
      missing: isMissingRelation(error),
      error: error.message ?? "count_failed",
    };
  }
  return { ok: true, count: typeof count === "number" ? count : 0 };
}

/**
 * GET — SKG AI Management Dashboard snapshot.
 * Requires help_ai.view. FAQ counts require help.view (else forbidden).
 * Does not call Gemini Edge Functions or return conversation content.
 */
export async function GET(request: Request) {
  const gate = await requireAdminPermission("help_ai.view", {
    request,
    auditModule: "help_ai",
  });
  if (!gate.ok) return gate.response;

  const canViewFaq = actorHasPermission(gate.actor, "help.view");
  const dateKey = kolkataDateKey();
  const dayStart = kolkataDayStartUtcIso(dateKey);
  const monthStart = kolkataMonthStartUtcIso(dateKey);

  try {
    // --- Settings ---
    const { data: settingsRow, error: settingsError } = await gate.supabase
      .from("skg_ai_settings")
      .select(
        `help_center_enabled, voice_enabled, voice_connectivity_verified_at,
         weekly_allowance_seconds, max_session_seconds, lease_seconds,
         gemini_model_id, emergency_disabled, emergency_reason,
         emergency_disabled_at, updated_at`,
      )
      .eq("id", 1)
      .maybeSingle();

    const settingsMissing = isMissingRelation(settingsError);
    const settings =
      !settingsError && settingsRow
        ? {
            help_center_enabled: settingsRow.help_center_enabled !== false,
            voice_enabled: settingsRow.voice_enabled === true,
            voice_connectivity_verified_at:
              (settingsRow.voice_connectivity_verified_at as string | null) ??
              null,
            weekly_allowance_seconds: Number(
              settingsRow.weekly_allowance_seconds ?? 0,
            ),
            max_session_seconds: Number(settingsRow.max_session_seconds ?? 0),
            lease_seconds: Number(settingsRow.lease_seconds ?? 0),
            gemini_model_id: String(settingsRow.gemini_model_id ?? ""),
            emergency_disabled: settingsRow.emergency_disabled === true,
            emergency_reason:
              (settingsRow.emergency_reason as string | null) ?? null,
            emergency_disabled_at:
              (settingsRow.emergency_disabled_at as string | null) ?? null,
            updated_at: (settingsRow.updated_at as string | null) ?? null,
          }
        : null;

    const serviceStatus = settings
      ? {
          overall: deriveOverallAiStatus(settings),
          connectivity: deriveConnectivityStatus(
            settings.voice_connectivity_verified_at,
          ),
          voice: deriveVoiceAvailability(settings),
          help_center: deriveHelpCenterAvailability(settings),
          model_id: settings.gemini_model_id || null,
          weekly_allowance_seconds: settings.weekly_allowance_seconds || null,
          max_session_seconds: settings.max_session_seconds || null,
          emergency_disabled: settings.emergency_disabled,
          emergency_reason: settings.emergency_reason,
          settings_updated_at: settings.updated_at,
          source: "skg_ai_settings" as const,
        }
      : {
          overall: {
            status: "disabled" as const,
            label: settingsMissing
              ? "Settings table not configured"
              : "Settings unavailable",
          },
          connectivity: {
            status: "not_verified" as const,
            label: "Data unavailable",
            verified_at: null,
          },
          voice: { available: false, label: "Data unavailable" },
          help_center: { available: false, label: "Data unavailable" },
          model_id: null,
          weekly_allowance_seconds: null,
          max_session_seconds: null,
          emergency_disabled: null,
          emergency_reason: null,
          settings_updated_at: null,
          source: settingsMissing
            ? ("missing" as const)
            : ("error" as const),
        };

    // --- Knowledge / FAQ ---
    let knowledge: {
      categories_total: CountMetric;
      categories_active: CountMetric;
      categories_inactive: CountMetric;
      faqs_published: CountMetric;
      faqs_draft: CountMetric;
    };

    if (!canViewFaq) {
      knowledge = {
        categories_total: emptyForbidden(),
        categories_active: emptyForbidden(),
        categories_inactive: emptyForbidden(),
        faqs_published: emptyForbidden(),
        faqs_draft: emptyForbidden(),
      };
    } else {
      const [catsTotal, catsActive, faqsPublished, faqsDraft] =
        await Promise.all([
          headCount(gate.supabase, "help_faq_categories"),
          headCount(gate.supabase, "help_faq_categories", (q) =>
            q.eq("is_active", true),
          ),
          headCount(gate.supabase, "help_faqs", (q) =>
            q.eq("status", "published"),
          ),
          headCount(gate.supabase, "help_faqs", (q) => q.eq("status", "draft")),
        ]);

      if (
        !catsTotal.ok &&
        catsTotal.missing &&
        !faqsPublished.ok &&
        faqsPublished.missing
      ) {
        knowledge = {
          categories_total: emptyUnavailable("FAQ tables not configured"),
          categories_active: emptyUnavailable(),
          categories_inactive: emptyUnavailable(),
          faqs_published: emptyUnavailable(),
          faqs_draft: emptyUnavailable(),
        };
      } else {
        const total = catsTotal.ok ? catsTotal.count : null;
        const active = catsActive.ok ? catsActive.count : null;
        knowledge = {
          categories_total: catsTotal.ok
            ? countMetric(catsTotal.count)
            : emptyUnavailable(),
          categories_active: catsActive.ok
            ? countMetric(catsActive.count)
            : emptyUnavailable(),
          categories_inactive:
            total != null && active != null
              ? countMetric(Math.max(total - active, 0))
              : emptyUnavailable(),
          faqs_published: faqsPublished.ok
            ? countMetric(faqsPublished.count)
            : emptyUnavailable(),
          faqs_draft: faqsDraft.ok
            ? countMetric(faqsDraft.count)
            : emptyUnavailable(),
        };
      }
    }

    // --- Voice usage ---
    const [
      totalSessions,
      endedSessions,
      failedSessions,
      expiredSessions,
      openReserved,
      openActive,
      todaySessions,
      monthSessions,
    ] = await Promise.all([
      headCount(gate.supabase, "skg_ai_voice_sessions"),
      headCount(gate.supabase, "skg_ai_voice_sessions", (q) =>
        q.eq("status", "ended"),
      ),
      headCount(gate.supabase, "skg_ai_voice_sessions", (q) =>
        q.eq("status", "failed"),
      ),
      headCount(gate.supabase, "skg_ai_voice_sessions", (q) =>
        q.eq("status", "expired"),
      ),
      headCount(gate.supabase, "skg_ai_voice_sessions", (q) =>
        q.eq("status", "reserved"),
      ),
      headCount(gate.supabase, "skg_ai_voice_sessions", (q) =>
        q.eq("status", "active"),
      ),
      headCount(gate.supabase, "skg_ai_voice_sessions", (q) =>
        q.gte("created_at", dayStart),
      ),
      headCount(gate.supabase, "skg_ai_voice_sessions", (q) =>
        q.gte("created_at", monthStart),
      ),
    ]);

    const sessionsMissing =
      !totalSessions.ok && totalSessions.missing;

    const settledTodayQuery = await gate.supabase
      .from("skg_ai_voice_sessions")
      .select("settled_seconds")
      .gte("created_at", dayStart)
      .limit(5000);
    const settledMonthQuery = await gate.supabase
      .from("skg_ai_voice_sessions")
      .select("settled_seconds")
      .gte("created_at", monthStart)
      .limit(5000);

    const usage = sessionsMissing
      ? {
          total_sessions: emptyUnavailable("Voice sessions table not configured"),
          successful_sessions: emptyUnavailable(),
          failed_sessions: emptyUnavailable(),
          expired_sessions: emptyUnavailable(),
          open_sessions: emptyUnavailable(),
          sessions_today: emptyUnavailable(),
          sessions_this_month: emptyUnavailable(),
          settled_seconds_today: emptyUnavailable(),
          settled_seconds_this_month: emptyUnavailable(),
          configured_weekly_allowance_seconds: settings
            ? countMetric(settings.weekly_allowance_seconds)
            : emptyUnavailable("Not configured"),
          note: "Per-user remaining quota requires get_skg_ai_quota() for a specific member and is not shown as a global remaining total.",
        }
      : {
          total_sessions: totalSessions.ok
            ? countMetric(totalSessions.count)
            : emptyUnavailable(),
          successful_sessions: endedSessions.ok
            ? countMetric(endedSessions.count)
            : emptyUnavailable(),
          failed_sessions: failedSessions.ok
            ? countMetric(failedSessions.count)
            : emptyUnavailable(),
          expired_sessions: expiredSessions.ok
            ? countMetric(expiredSessions.count)
            : emptyUnavailable(),
          open_sessions:
            openReserved.ok && openActive.ok
              ? countMetric(openReserved.count + openActive.count)
              : emptyUnavailable(),
          sessions_today: todaySessions.ok
            ? countMetric(todaySessions.count)
            : emptyUnavailable(),
          sessions_this_month: monthSessions.ok
            ? countMetric(monthSessions.count)
            : emptyUnavailable(),
          settled_seconds_today: settledTodayQuery.error
            ? emptyUnavailable()
            : countMetric(sumSettledSeconds(settledTodayQuery.data ?? [])),
          settled_seconds_this_month: settledMonthQuery.error
            ? emptyUnavailable()
            : countMetric(sumSettledSeconds(settledMonthQuery.data ?? [])),
          configured_weekly_allowance_seconds: settings
            ? countMetric(settings.weekly_allowance_seconds)
            : emptyUnavailable("Not configured"),
          note: "Successful = status ended. Failed = status failed. Settled seconds are summed from skg_ai_voice_sessions (capped query window). Weekly allowance is the configured policy from skg_ai_settings, not remaining per user.",
        };

    // --- Recent activity (audit + sessions; no transcripts / no user PII) ---
    const recent: Array<{
      at: string | null;
      event: string;
      status: string;
      source: "audit" | "voice_session";
    }> = [];

    const { data: auditRows } = await gate.supabase
      .from("admin_panel_audit_logs")
      .select("created_at, action, description, success, outcome, module")
      .in("module", ["help", "help_ai"])
      .order("created_at", { ascending: false })
      .limit(12);

    for (const row of auditRows ?? []) {
      recent.push({
        ...sanitizeAuditActivity({
          created_at: (row.created_at as string | null) ?? null,
          action: (row.action as string | null) ?? null,
          description: (row.description as string | null) ?? null,
          success:
            typeof row.success === "boolean" ? row.success : null,
          outcome: (row.outcome as string | null) ?? null,
        }),
        source: "audit",
      });
    }

    if (!sessionsMissing) {
      const { data: sessionRows } = await gate.supabase
        .from("skg_ai_voice_sessions")
        .select("created_at, status, end_reason")
        .order("created_at", { ascending: false })
        .limit(12);

      for (const row of sessionRows ?? []) {
        recent.push({
          at: (row.created_at as string | null) ?? null,
          event: formatSessionActivityLabel({
            status: String(row.status ?? "unknown"),
            end_reason: (row.end_reason as string | null) ?? null,
          }),
          status: String(row.status ?? "unknown"),
          source: "voice_session",
        });
      }
    }

    recent.sort((a, b) => {
      const ta = a.at ? Date.parse(a.at) : 0;
      const tb = b.at ? Date.parse(b.at) : 0;
      return tb - ta;
    });

    const quickLinks = dashboardQuickLinks((permission) =>
      actorHasPermission(gate.actor, permission),
    );

    return NextResponse.json({
      ok: true,
      generated_at: new Date().toISOString(),
      timezone: "Asia/Kolkata",
      date_key: dateKey,
      service_status: serviceStatus,
      knowledge,
      usage,
      recent_activity: recent.slice(0, 15),
      quick_links: quickLinks,
      meta: {
        faq_metrics_require_help_view: true,
        actor_has_help_view: canViewFaq,
        live_gemini_probe: false,
        note: "Connectivity reflects skg_ai_settings.voice_connectivity_verified_at only; this endpoint does not call verify-skg-ai-gemini-connectivity.",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: safeErrorMessage(error, "Failed to load AI dashboard."),
      },
      { status: 500 },
    );
  }
}
