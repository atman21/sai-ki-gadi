import { NextResponse } from "next/server";

import {
  requireAdminPermission,
  safeErrorMessage,
} from "@/lib/admin-api";
import {
  clientMetaFromRequest,
  recordChange,
  recordFailure,
} from "@/lib/admin-audit";
import {
  mapSettingsRow,
  publicAiSettingsView,
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
 * POST — maintenance / emergency availability control.
 * Body: { action: "disable" | "enable", reason?: string }
 *
 * disable → service-role RPC emergency_terminate_skg_ai_sessions (sets
 *   emergency_disabled + terminates open voice sessions).
 * enable → clears emergency flags on skg_ai_settings only (no Edge changes).
 */
export async function POST(request: Request) {
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
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json(
        { ok: false, error: "Body must be an object." },
        { status: 400 },
      );
    }

    const action = String((body as { action?: unknown }).action ?? "");
    const reasonRaw = (body as { reason?: unknown }).reason;
    const reason =
      typeof reasonRaw === "string" ? reasonRaw.trim().slice(0, 500) : "";

    const { data: beforeRaw } = await gate.supabase
      .from("skg_ai_settings")
      .select(SETTINGS_SELECT)
      .eq("id", 1)
      .maybeSingle();
    const before = mapSettingsRow(beforeRaw);

    if (action === "disable") {
      if (!reason) {
        return NextResponse.json(
          { ok: false, error: "A reason is required to disable AI availability." },
          { status: 400 },
        );
      }

      const { data: rpcData, error: rpcError } = await gate.supabase.rpc(
        "emergency_terminate_skg_ai_sessions",
        { p_reason: reason },
      );

      if (rpcError) {
        void recordFailure({
          ...auditBase,
          action: "help_ai.emergency_disable",
          description: "Failed emergency disable for SKG AI",
          reason: rpcError.message,
        });
        return NextResponse.json(
          {
            ok: false,
            error: safeErrorMessage(
              rpcError,
              "Failed to emergency-disable SKG AI.",
            ),
          },
          { status: 500 },
        );
      }

      // Stamp actor on settings (RPC sets flags but not emergency_disabled_by).
      await gate.supabase
        .from("skg_ai_settings")
        .update({
          emergency_disabled_by: gate.actor.id,
          updated_by: gate.actor.id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", 1);

      const { data: afterRaw } = await gate.supabase
        .from("skg_ai_settings")
        .select(SETTINGS_SELECT)
        .eq("id", 1)
        .maybeSingle();
      const after = mapSettingsRow(afterRaw);

      void recordChange({
        ...auditBase,
        action: "help_ai.emergency_disable",
        description: "Emergency / maintenance disable for SKG AI",
        changedFields: ["emergency_disabled", "emergency_reason"],
        beforeData: settingsAuditSnapshot(before),
        afterData: {
          ...settingsAuditSnapshot(after),
          rpc_result: rpcData ?? null,
        },
      });

      return NextResponse.json({
        ok: true,
        action: "disable",
        settings: after ? publicAiSettingsView(after) : null,
        rpc_result: rpcData ?? null,
      });
    }

    if (action === "enable") {
      const { data: afterRaw, error } = await gate.supabase
        .from("skg_ai_settings")
        .update({
          emergency_disabled: false,
          emergency_reason: null,
          emergency_disabled_at: null,
          emergency_disabled_by: null,
          updated_by: gate.actor.id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", 1)
        .select(SETTINGS_SELECT)
        .maybeSingle();

      if (error) {
        void recordFailure({
          ...auditBase,
          action: "help_ai.emergency_enable",
          description: "Failed to clear SKG AI emergency disable",
          reason: error.message,
        });
        return NextResponse.json(
          {
            ok: false,
            error: safeErrorMessage(error, "Failed to re-enable SKG AI."),
          },
          { status: 500 },
        );
      }

      const after = mapSettingsRow(afterRaw);
      void recordChange({
        ...auditBase,
        action: "help_ai.emergency_enable",
        description: "Cleared SKG AI emergency / maintenance disable",
        changedFields: [
          "emergency_disabled",
          "emergency_reason",
          "emergency_disabled_at",
          "emergency_disabled_by",
        ],
        beforeData: settingsAuditSnapshot(before),
        afterData: settingsAuditSnapshot(after),
      });

      return NextResponse.json({
        ok: true,
        action: "enable",
        settings: after ? publicAiSettingsView(after) : null,
      });
    }

    return NextResponse.json(
      { ok: false, error: 'action must be "disable" or "enable".' },
      { status: 400 },
    );
  } catch (error) {
    void recordFailure({
      ...auditBase,
      action: "help_ai.emergency_disable",
      description: "Emergency endpoint failure",
      reason: safeErrorMessage(error, "emergency_failed"),
    });
    return NextResponse.json(
      {
        ok: false,
        error: safeErrorMessage(error, "Emergency action failed."),
      },
      { status: 500 },
    );
  }
}
