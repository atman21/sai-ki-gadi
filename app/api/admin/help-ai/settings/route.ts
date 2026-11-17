import { NextResponse } from "next/server";

import { requireAdminPermission } from "@/lib/admin-api";
import {
  clientMetaFromRequest,
  recordFailure,
  recordSuccess,
} from "@/lib/admin-audit";
import { parseBool, parseBoundedInt } from "@/lib/help-center";
import { supabaseAdmin } from "@/lib/supabase-admin";

const SETTINGS_SELECT = `
  id, help_center_enabled, voice_enabled, voice_connectivity_verified_at,
  weekly_allowance_seconds, max_session_seconds, lease_seconds,
  gemini_model_id, supported_locales, session_resumption_enabled,
  emergency_disabled, emergency_reason, emergency_disabled_at,
  emergency_disabled_by, updated_at, updated_by
`;

export async function GET(request: Request) {
  const gate = await requireAdminPermission("help_ai.view", {
    request,
    auditModule: "help_ai",
  });
  if (!gate.ok) return gate.response;

  const { data, error } = await supabaseAdmin
    .from("skg_ai_settings")
    .select(SETTINGS_SELECT)
    .eq("id", 1)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json(
      { ok: false, error: "AI settings row missing." },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true, row: data });
}

export async function PATCH(request: Request) {
  const gate = await requireAdminPermission("help_ai.manage", {
    request,
    auditModule: "help_ai",
  });
  if (!gate.ok) return gate.response;

  try {
    const body = await request.json();
    const confirmed = body?.confirm === true;

    const { data: before } = await supabaseAdmin
      .from("skg_ai_settings")
      .select(SETTINGS_SELECT)
      .eq("id", 1)
      .maybeSingle();

    if (!before) {
      return NextResponse.json(
        { ok: false, error: "AI settings row missing." },
        { status: 404 },
      );
    }

    const patch: Record<string, unknown> = {
      updated_by: gate.actor.id ?? null,
    };
    const sensitiveChanges: string[] = [];

    if (body?.help_center_enabled !== undefined) {
      patch.help_center_enabled = parseBool(
        body.help_center_enabled,
        before.help_center_enabled,
      );
    }

    if (body?.weekly_allowance_seconds !== undefined) {
      const v = parseBoundedInt(body.weekly_allowance_seconds, "weekly_allowance_seconds");
      if (!v.ok) {
        return NextResponse.json({ ok: false, error: v.error }, { status: 400 });
      }
      if (v.value !== before.weekly_allowance_seconds) {
        sensitiveChanges.push("weekly_allowance_seconds");
      }
      patch.weekly_allowance_seconds = v.value;
    }

    if (body?.max_session_seconds !== undefined) {
      const v = parseBoundedInt(body.max_session_seconds, "max_session_seconds");
      if (!v.ok) {
        return NextResponse.json({ ok: false, error: v.error }, { status: 400 });
      }
      if (v.value !== before.max_session_seconds) {
        sensitiveChanges.push("max_session_seconds");
      }
      patch.max_session_seconds = v.value;
    }

    if (body?.lease_seconds !== undefined) {
      const v = parseBoundedInt(body.lease_seconds, "lease_seconds");
      if (!v.ok) {
        return NextResponse.json({ ok: false, error: v.error }, { status: 400 });
      }
      patch.lease_seconds = v.value;
    }

    if (body?.session_resumption_enabled !== undefined) {
      const next = parseBool(
        body.session_resumption_enabled,
        before.session_resumption_enabled,
      );
      if (next !== before.session_resumption_enabled) {
        sensitiveChanges.push("session_resumption_enabled");
      }
      patch.session_resumption_enabled = next;
    }

    // voice_enabled: never set connectivity; only allow enable when verified.
    // Do not flip voice on accidentally — require explicit body field + confirm.
    if (body?.voice_enabled !== undefined) {
      const next = parseBool(body.voice_enabled, before.voice_enabled);
      if (next === true) {
        if (!before.voice_connectivity_verified_at) {
          return NextResponse.json(
            {
              ok: false,
              error:
                "Cannot enable voice: connectivity is not verified (voice_connectivity_verified_at is null). Verification is out of scope for this Admin action.",
            },
            { status: 400 },
          );
        }
        sensitiveChanges.push("voice_enabled");
      } else if (before.voice_enabled) {
        sensitiveChanges.push("voice_enabled");
      }
      patch.voice_enabled = next;
    }

    // Explicitly refuse connectivity / model secret-adjacent writes from this endpoint.
    if (
      body?.voice_connectivity_verified_at !== undefined ||
      body?.gemini_model_id !== undefined
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "This endpoint does not modify connectivity verification or model id. Use the dedicated verification workflow.",
        },
        { status: 400 },
      );
    }

    if (Object.keys(patch).length <= 1) {
      return NextResponse.json(
        { ok: false, error: "No valid settings fields to update." },
        { status: 400 },
      );
    }

    if (sensitiveChanges.length > 0 && !confirmed) {
      return NextResponse.json(
        {
          ok: false,
          error: "Confirmation required for sensitive settings changes.",
          requires_confirm: true,
          sensitive_fields: sensitiveChanges,
        },
        { status: 400 },
      );
    }

    const { data, error } = await supabaseAdmin
      .from("skg_ai_settings")
      .update(patch)
      .eq("id", 1)
      .select(SETTINGS_SELECT)
      .single();

    if (error) {
      void recordFailure({
        actor: gate.actor,
        action: "help_ai.settings.update",
        module: "help_ai",
        description: "Failed to update AI settings",
        resourceType: "skg_ai_settings",
        resourceId: "1",
        reason: error.message,
        ...clientMetaFromRequest(request),
      });
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }

    void recordSuccess({
      actor: gate.actor,
      action: "help_ai.settings.update",
      module: "help_ai",
      description: "AI Help settings updated",
      resourceType: "skg_ai_settings",
      resourceId: "1",
      beforeData: before,
      afterData: data ?? undefined,
      changedFields: Object.keys(patch).filter((k) => k !== "updated_by"),
      ...clientMetaFromRequest(request),
    });

    return NextResponse.json({ ok: true, row: data });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Internal error" },
      { status: 500 },
    );
  }
}
