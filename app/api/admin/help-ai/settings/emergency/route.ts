import { NextResponse } from "next/server";

import { requireAdminPermission } from "@/lib/admin-api";
import {
  clientMetaFromRequest,
  recordFailure,
  recordSuccess,
} from "@/lib/admin-audit";
import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * POST { action: "disable"|"enable", reason?, confirm: true }
 * Disable uses emergency_terminate_skg_ai_sessions RPC (atomic).
 * Enable clears emergency flags only — does not enable voice.
 */
export async function POST(request: Request) {
  const gate = await requireAdminPermission("help_ai.manage", {
    request,
    auditModule: "help_ai",
  });
  if (!gate.ok) return gate.response;

  try {
    const body = await request.json();
    const action = body?.action === "enable" ? "enable" : "disable";
    if (body?.confirm !== true) {
      return NextResponse.json(
        {
          ok: false,
          error: "Confirmation required.",
          requires_confirm: true,
        },
        { status: 400 },
      );
    }

    const { data: before } = await supabaseAdmin
      .from("skg_ai_settings")
      .select(
        "id, emergency_disabled, emergency_reason, emergency_disabled_at, voice_enabled, voice_connectivity_verified_at",
      )
      .eq("id", 1)
      .maybeSingle();

    if (!before) {
      return NextResponse.json(
        { ok: false, error: "AI settings row missing." },
        { status: 404 },
      );
    }

    if (action === "disable") {
      const reason =
        typeof body?.reason === "string" && body.reason.trim()
          ? body.reason.trim().slice(0, 500)
          : "emergency_disable";

      const { data: rpcResult, error } = await supabaseAdmin.rpc(
        "emergency_terminate_skg_ai_sessions",
        { p_reason: reason },
      );

      if (error) {
        void recordFailure({
          actor: gate.actor,
          action: "help_ai.emergency_disable",
          module: "help_ai",
          description: "Emergency disable failed",
          resourceType: "skg_ai_settings",
          resourceId: "1",
          reason: error.message,
          ...clientMetaFromRequest(request),
        });
        return NextResponse.json(
          { ok: false, error: error.message },
          { status: 500 },
        );
      }

      // Stamp actor after RPC (RPC does not accept admin id).
      await supabaseAdmin
        .from("skg_ai_settings")
        .update({
          emergency_disabled_by: gate.actor.id ?? null,
          updated_by: gate.actor.id ?? null,
        })
        .eq("id", 1);

      const { data: after } = await supabaseAdmin
        .from("skg_ai_settings")
        .select(
          "id, emergency_disabled, emergency_reason, emergency_disabled_at, emergency_disabled_by, voice_enabled, voice_connectivity_verified_at, updated_at",
        )
        .eq("id", 1)
        .maybeSingle();

      void recordSuccess({
        actor: gate.actor,
        action: "help_ai.emergency_disable",
        module: "help_ai",
        description: `Emergency disable: ${reason}`,
        resourceType: "skg_ai_settings",
        resourceId: "1",
        beforeData: before,
        afterData: after ?? undefined,
        metadata: { rpc: rpcResult },
        ...clientMetaFromRequest(request),
      });

      return NextResponse.json({
        ok: true,
        action: "disable",
        row: after,
        rpc: rpcResult,
      });
    }

    // enable — clear emergency only; never flip voice_enabled or connectivity.
    const { data: after, error } = await supabaseAdmin
      .from("skg_ai_settings")
      .update({
        emergency_disabled: false,
        emergency_reason: null,
        emergency_disabled_at: null,
        emergency_disabled_by: null,
        updated_by: gate.actor.id ?? null,
      })
      .eq("id", 1)
      .select(
        "id, emergency_disabled, emergency_reason, emergency_disabled_at, emergency_disabled_by, voice_enabled, voice_connectivity_verified_at, updated_at",
      )
      .single();

    if (error) {
      void recordFailure({
        actor: gate.actor,
        action: "help_ai.emergency_enable",
        module: "help_ai",
        description: "Failed to clear emergency disable",
        resourceType: "skg_ai_settings",
        resourceId: "1",
        reason: error.message,
        ...clientMetaFromRequest(request),
      });
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }

    void recordSuccess({
      actor: gate.actor,
      action: "help_ai.emergency_enable",
      module: "help_ai",
      description: "Emergency disable cleared (voice left unchanged)",
      resourceType: "skg_ai_settings",
      resourceId: "1",
      beforeData: before,
      afterData: after ?? undefined,
      ...clientMetaFromRequest(request),
    });

    return NextResponse.json({ ok: true, action: "enable", row: after });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Internal error" },
      { status: 500 },
    );
  }
}
