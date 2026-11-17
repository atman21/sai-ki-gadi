import { NextResponse } from "next/server";

import {
  requireAdminPermission,
  safeErrorMessage,
} from "@/lib/admin-api";
import {
  clientMetaFromRequest,
  diffChangedFields,
  recordChange,
  recordFailure,
} from "@/lib/admin-audit";
import {
  mapSettingsRow,
  publicAiSettingsView,
  sanitizeAiSettingsUpdate,
  settingsAuditSnapshot,
} from "@/lib/ai-settings-admin";

const SETTINGS_SELECT = `
  id, help_center_enabled, voice_enabled, voice_connectivity_verified_at,
  weekly_allowance_seconds, max_session_seconds, lease_seconds,
  gemini_model_id, supported_locales, session_resumption_enabled,
  emergency_disabled, emergency_reason, emergency_disabled_at,
  emergency_disabled_by, updated_at, updated_by
`;

/**
 * GET — load skg_ai_settings singleton.
 * Requires help_ai.manage (AI Settings tab is manage-gated).
 */
export async function GET(request: Request) {
  const gate = await requireAdminPermission("help_ai.manage", {
    request,
    auditModule: "help_ai",
  });
  if (!gate.ok) return gate.response;

  try {
    const { data, error } = await gate.supabase
      .from("skg_ai_settings")
      .select(SETTINGS_SELECT)
      .eq("id", 1)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          error: safeErrorMessage(error, "Failed to load AI settings."),
        },
        { status: 500 },
      );
    }

    const row = mapSettingsRow(data as Record<string, unknown> | null);
    if (!row) {
      return NextResponse.json(
        { ok: false, error: "AI settings row (id=1) not found." },
        { status: 404 },
      );
    }

    let instructionsFallback: string | null = null;
    let instructionsScopeNote: string | null = null;
    const { data: publishedInstruction } = await gate.supabase
      .from("skg_ai_instructions")
      .select("fallback_message, skg_scope_restriction")
      .eq("id", "global-published")
      .maybeSingle();
    if (publishedInstruction) {
      instructionsFallback =
        typeof publishedInstruction.fallback_message === "string"
          ? publishedInstruction.fallback_message
          : null;
      instructionsScopeNote =
        typeof publishedInstruction.skg_scope_restriction === "string"
          ? publishedInstruction.skg_scope_restriction.slice(0, 280)
          : null;
    }

    return NextResponse.json({
      ok: true,
      settings: publicAiSettingsView(row),
      related: {
        instructions_tab: "/dashboard?tab=ai-instructions",
        published_fallback_message: instructionsFallback,
        published_scope_preview: instructionsScopeNote,
      },
      meta: {
        source: "skg_ai_settings",
        singleton_id: 1,
        gemini_live_untouched: true,
        note: "Quota/session gates remain server-enforced via get_skg_ai_quota / reserve / mint.",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: safeErrorMessage(error, "Failed to load AI settings."),
      },
      { status: 500 },
    );
  }
}

/**
 * PUT — update operational settings (not emergency kill-switch).
 * Requires help_ai.manage. Does not modify Gemini Edge Functions.
 */
export async function PUT(request: Request) {
  const gate = await requireAdminPermission("help_ai.manage", {
    request,
    auditModule: "help_ai",
  });
  if (!gate.ok) return gate.response;

  const auditBase = {
    actor: gate.actor,
    module: "help_ai",
    resourceType: "skg_ai_settings",
    resourceId: "1",
    ...clientMetaFromRequest(request),
  };

  try {
    const body = await request.json().catch(() => null);

    const { data: beforeRaw, error: loadError } = await gate.supabase
      .from("skg_ai_settings")
      .select(SETTINGS_SELECT)
      .eq("id", 1)
      .maybeSingle();

    if (loadError) {
      return NextResponse.json(
        {
          ok: false,
          error: safeErrorMessage(loadError, "Failed to load AI settings."),
        },
        { status: 500 },
      );
    }

    const before = mapSettingsRow(beforeRaw as Record<string, unknown> | null);
    if (!before) {
      return NextResponse.json(
        { ok: false, error: "AI settings row (id=1) not found." },
        { status: 404 },
      );
    }

    const sanitized = sanitizeAiSettingsUpdate(body, before);
    if (!sanitized.ok) {
      return NextResponse.json(
        { ok: false, error: sanitized.error },
        { status: 400 },
      );
    }

    if (
      Object.keys(sanitized.patch).length === 0 &&
      !sanitized.markConnectivity
    ) {
      return NextResponse.json(
        { ok: false, error: "No settings changes provided." },
        { status: 400 },
      );
    }

    const updatePayload: Record<string, unknown> = {
      ...sanitized.patch,
      updated_by: gate.actor.id,
      updated_at: new Date().toISOString(),
    };

    if (sanitized.markConnectivity) {
      updatePayload.voice_connectivity_verified_at = new Date().toISOString();
    }

    const { data, error } = await gate.supabase
      .from("skg_ai_settings")
      .update(updatePayload)
      .eq("id", 1)
      .select(SETTINGS_SELECT)
      .maybeSingle();

    if (error) {
      void recordFailure({
        ...auditBase,
        action: sanitized.markConnectivity
          ? "help_ai.voice_connectivity.verify"
          : "help_ai.settings.update",
        description: "Failed to update AI settings",
        reason: error.message,
      });
      return NextResponse.json(
        {
          ok: false,
          error: safeErrorMessage(error, "Failed to update AI settings."),
        },
        { status: 500 },
      );
    }

    const after = mapSettingsRow(data as Record<string, unknown> | null);
    if (!after) {
      return NextResponse.json(
        { ok: false, error: "Settings updated but could not reload row." },
        { status: 500 },
      );
    }

    const beforeSnap = settingsAuditSnapshot(before);
    const afterSnap = settingsAuditSnapshot(after);
    const changed = diffChangedFields(beforeSnap, afterSnap);

    void recordChange({
      ...auditBase,
      action: sanitized.markConnectivity
        ? "help_ai.voice_connectivity.verify"
        : "help_ai.settings.update",
      description: sanitized.markConnectivity
        ? "Marked SKG AI voice connectivity verified"
        : "Updated SKG AI settings",
      changedFields: changed,
      beforeData: beforeSnap,
      afterData: afterSnap,
    });

    return NextResponse.json({
      ok: true,
      settings: publicAiSettingsView(after),
      changed_fields: changed,
    });
  } catch (error) {
    void recordFailure({
      ...auditBase,
      action: "help_ai.settings.update",
      description: "Failed to update AI settings",
      reason: safeErrorMessage(error, "update_failed"),
    });
    return NextResponse.json(
      {
        ok: false,
        error: safeErrorMessage(error, "Failed to update AI settings."),
      },
      { status: 500 },
    );
  }
}
