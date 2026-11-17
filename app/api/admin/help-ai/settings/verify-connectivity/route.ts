import { NextResponse } from "next/server";

import { requireAdminPermission } from "@/lib/admin-api";
import {
  clientMetaFromRequest,
  recordFailure,
  recordSuccess,
} from "@/lib/admin-audit";
import { supabaseAdmin } from "@/lib/supabase-admin";

const DEV_PROJECT_REF = "mnbwcwaxfywwkaxiwndo";

const SETTINGS_SELECT = `
  id, help_center_enabled, voice_enabled, voice_connectivity_verified_at,
  weekly_allowance_seconds, max_session_seconds, lease_seconds,
  gemini_model_id, supported_locales, session_resumption_enabled,
  emergency_disabled, emergency_reason, emergency_disabled_at,
  emergency_disabled_by, updated_at, updated_by
`;

function isDevSupabaseUrl(url: string): boolean {
  return url.includes(DEV_PROJECT_REF);
}

function summarizeProbe(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }
  const p = payload as Record<string, unknown>;
  const steps = p.steps;
  const stepSummary: Record<string, unknown> = {};
  if (steps && typeof steps === "object" && !Array.isArray(steps)) {
    for (const [k, v] of Object.entries(steps as Record<string, unknown>)) {
      if (v && typeof v === "object" && !Array.isArray(v)) {
        const s = v as Record<string, unknown>;
        stepSummary[k] = {
          status: typeof s.status === "string" ? s.status : null,
          code: typeof s.code === "string" ? s.code : null,
        };
      }
    }
  }
  return {
    ok: p.ok === true,
    model: typeof p.model === "string" ? p.model : null,
    may_stamp_connectivity: p.may_stamp_connectivity === true,
    stamps_voice_enabled: p.stamps_voice_enabled === true ? true : false,
    steps: stepSummary,
  };
}

/**
 * T30-B — Admin-triggered Dev-only Gemini connectivity verification.
 * Stamps voice_connectivity_verified_at only on full probe success.
 * Never sets voice_enabled.
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

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";

  if (!supabaseUrl || !serviceRoleKey) {
    void recordFailure({
      ...auditBase,
      action: "help_ai.voice_connectivity.verify",
      description: "Connectivity verify blocked: incomplete server config",
      reason: "Supabase server configuration is incomplete.",
      metadata: { stamped: false, voice_enabled_changed: false },
    });
    return NextResponse.json(
      { ok: false, error: "Supabase server configuration is incomplete." },
      { status: 503 },
    );
  }

  if (!isDevSupabaseUrl(supabaseUrl)) {
    void recordFailure({
      ...auditBase,
      action: "help_ai.voice_connectivity.verify",
      description: "Connectivity verify refused: non-Dev project",
      reason: "Dev-only verification.",
      metadata: { stamped: false, voice_enabled_changed: false },
    });
    return NextResponse.json(
      {
        ok: false,
        error: `Connectivity verification is Dev-only (${DEV_PROJECT_REF}).`,
        code: "not_dev",
      },
      { status: 403 },
    );
  }

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

  let probePayload: unknown = null;
  let probeStatus = 0;

  try {
    const response = await fetch(
      `${supabaseUrl}/functions/v1/verify-skg-ai-gemini-connectivity`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({ confirm: true }),
      },
    );
    probeStatus = response.status;
    probePayload = await response.json().catch(() => null);
  } catch {
    void recordFailure({
      ...auditBase,
      action: "help_ai.voice_connectivity.verify",
      description: "Connectivity verify failed: Edge invoke error",
      reason: "Edge function invoke failed.",
      beforeData: {
        voice_connectivity_verified_at: before.voice_connectivity_verified_at,
        voice_enabled: before.voice_enabled,
      },
      metadata: { stamped: false, voice_enabled_changed: false },
    });
    return NextResponse.json(
      { ok: false, error: "Failed to invoke connectivity verification." },
      { status: 502 },
    );
  }

  const summary = summarizeProbe(probePayload);
  const mayStamp =
    probeStatus === 200 &&
    summary.ok === true &&
    summary.may_stamp_connectivity === true;

  if (!mayStamp) {
    void recordFailure({
      ...auditBase,
      action: "help_ai.voice_connectivity.verify",
      description: "Connectivity verify failed; connectivity not stamped",
      reason:
        (probePayload &&
          typeof probePayload === "object" &&
          "message" in probePayload &&
          typeof (probePayload as { message: unknown }).message === "string" &&
          (probePayload as { message: string }).message) ||
        `Probe returned HTTP ${probeStatus}`,
      beforeData: {
        voice_connectivity_verified_at: before.voice_connectivity_verified_at,
        voice_enabled: before.voice_enabled,
      },
      metadata: {
        stamped: false,
        voice_enabled_changed: false,
        probeStatus,
        probe: summary,
      },
    });

    return NextResponse.json(
      {
        ok: false,
        error: "Gemini connectivity verification failed.",
        stamped: false,
        voice_enabled: before.voice_enabled,
        voice_connectivity_verified_at: before.voice_connectivity_verified_at,
        probe: summary,
      },
      { status: probeStatus >= 400 ? probeStatus : 502 },
    );
  }

  const verifiedAt = new Date().toISOString();
  const { data: after, error: updateError } = await supabaseAdmin
    .from("skg_ai_settings")
    .update({
      voice_connectivity_verified_at: verifiedAt,
      updated_by: gate.actor.id ?? null,
      // Explicitly never touch voice_enabled.
    })
    .eq("id", 1)
    .select(SETTINGS_SELECT)
    .maybeSingle();

  if (updateError || !after) {
    void recordFailure({
      ...auditBase,
      action: "help_ai.voice_connectivity.verify",
      description: "Probe succeeded but stamp update failed",
      reason: updateError?.message ?? "Update returned no row",
      metadata: {
        stamped: false,
        voice_enabled_changed: false,
        probe: summary,
      },
    });
    return NextResponse.json(
      {
        ok: false,
        error: "Verification succeeded but failed to stamp connectivity.",
        stamped: false,
        probe: summary,
      },
      { status: 500 },
    );
  }

  // Defense in depth: refuse if voice_enabled flipped somehow.
  if (after.voice_enabled !== before.voice_enabled) {
    void recordFailure({
      ...auditBase,
      action: "help_ai.voice_connectivity.verify",
      description: "Aborted: voice_enabled changed unexpectedly",
      reason: "voice_enabled must not change during connectivity verify.",
      beforeData: { voice_enabled: before.voice_enabled },
      afterData: { voice_enabled: after.voice_enabled },
      metadata: { stamped: true, voice_enabled_changed: true, probe: summary },
    });
    return NextResponse.json(
      {
        ok: false,
        error: "Connectivity stamped but voice_enabled changed unexpectedly.",
        stamped: true,
        row: after,
        probe: summary,
      },
      { status: 500 },
    );
  }

  void recordSuccess({
    ...auditBase,
    action: "help_ai.voice_connectivity.verify",
    description: "Gemini Live connectivity verified; stamp set; voice not enabled",
    changedFields: ["voice_connectivity_verified_at"],
    beforeData: {
      voice_connectivity_verified_at: before.voice_connectivity_verified_at,
      voice_enabled: before.voice_enabled,
    },
    afterData: {
      voice_connectivity_verified_at: after.voice_connectivity_verified_at,
      voice_enabled: after.voice_enabled,
    },
    metadata: {
      stamped: true,
      voice_enabled_changed: false,
      probe: summary,
    },
  });

  return NextResponse.json({
    ok: true,
    stamped: true,
    voice_enabled: after.voice_enabled,
    voice_connectivity_verified_at: after.voice_connectivity_verified_at,
    row: after,
    probe: summary,
  });
}
