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
  computeMaintenanceActive,
  mapMaintenanceSettingsRow,
  maintenanceAuditSnapshot,
  sanitizeMaintenanceSettingsUpdate,
} from "@/lib/app-maintenance-admin";

const SETTINGS_SELECT = `
  id, enabled, force_emergency, owner_bypass_enabled, logged_out_policy,
  title, message, translations, image_url, support_contact,
  expected_return_at, start_at, end_at, updated_at, updated_by
`;

export async function GET(request: Request) {
  const gate = await requireAdminPermission("app.view", {
    request,
    auditModule: "app",
  });
  if (!gate.ok) return gate.response;

  try {
    const { data, error } = await gate.supabase
      .from("skg_app_maintenance_settings")
      .select(SETTINGS_SELECT)
      .eq("id", 1)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          error: safeErrorMessage(
            error,
            "Failed to load maintenance settings (migration may be unapplied).",
          ),
        },
        { status: 500 },
      );
    }

    const row = mapMaintenanceSettingsRow(
      data as Record<string, unknown> | null,
    );
    if (!row) {
      return NextResponse.json(
        { ok: false, error: "Maintenance settings row (id=1) not found." },
        { status: 404 },
      );
    }

    return NextResponse.json({
      ok: true,
      settings: row,
      effective_active: computeMaintenanceActive(row),
      meta: {
        source: "skg_app_maintenance_settings",
        note: "Allowlist is never returned from Mobile RPC; Admin uses service-role APIs.",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: safeErrorMessage(error, "Failed to load maintenance settings."),
      },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  const gate = await requireAdminPermission("app.manage", {
    request,
    auditModule: "app",
  });
  if (!gate.ok) return gate.response;

  const auditBase = {
    actor: gate.actor,
    module: "app",
    resourceType: "skg_app_maintenance_settings",
    resourceId: "1",
    ...clientMetaFromRequest(request),
  };

  try {
    const body = await request.json().catch(() => null);

    const { data: beforeRaw, error: loadError } = await gate.supabase
      .from("skg_app_maintenance_settings")
      .select(SETTINGS_SELECT)
      .eq("id", 1)
      .maybeSingle();

    if (loadError) {
      return NextResponse.json(
        {
          ok: false,
          error: safeErrorMessage(loadError, "Failed to load settings."),
        },
        { status: 500 },
      );
    }

    const before = mapMaintenanceSettingsRow(
      beforeRaw as Record<string, unknown> | null,
    );
    if (!before) {
      return NextResponse.json(
        { ok: false, error: "Maintenance settings row not found." },
        { status: 404 },
      );
    }

    const sanitized = sanitizeMaintenanceSettingsUpdate(body, before);
    if (!sanitized.ok) {
      return NextResponse.json(
        { ok: false, error: sanitized.error },
        { status: 400 },
      );
    }
    if (Object.keys(sanitized.patch).length === 0) {
      return NextResponse.json(
        { ok: false, error: "No settings changes provided." },
        { status: 400 },
      );
    }

    const updatePayload: Record<string, unknown> = {
      ...sanitized.patch,
      updated_by: gate.actor.id,
    };

    const { data, error } = await gate.supabase
      .from("skg_app_maintenance_settings")
      .update(updatePayload)
      .eq("id", 1)
      .select(SETTINGS_SELECT)
      .maybeSingle();

    if (error) {
      void recordFailure({
        ...auditBase,
        action: "app.maintenance.update",
        description: "Failed to update app maintenance settings",
        reason: error.message,
      });
      return NextResponse.json(
        {
          ok: false,
          error: safeErrorMessage(error, "Failed to update settings."),
        },
        { status: 500 },
      );
    }

    const after = mapMaintenanceSettingsRow(
      data as Record<string, unknown> | null,
    );
    if (!after) {
      return NextResponse.json(
        { ok: false, error: "Updated but could not reload settings." },
        { status: 500 },
      );
    }

    const beforeSnap = maintenanceAuditSnapshot(before);
    const afterSnap = maintenanceAuditSnapshot(after);
    const changed = diffChangedFields(beforeSnap, afterSnap);

    const togglingOn =
      (before.enabled !== after.enabled ||
        before.force_emergency !== after.force_emergency) &&
      computeMaintenanceActive(after) &&
      !computeMaintenanceActive(before);

    void recordChange({
      ...auditBase,
      action: togglingOn
        ? "app.maintenance.enable"
        : !computeMaintenanceActive(after) && computeMaintenanceActive(before)
          ? "app.maintenance.disable"
          : "app.maintenance.update",
      description: "Updated app maintenance settings",
      changedFields: changed,
      beforeData: beforeSnap,
      afterData: afterSnap,
    });

    return NextResponse.json({
      ok: true,
      settings: after,
      effective_active: computeMaintenanceActive(after),
      changed_fields: changed,
    });
  } catch (error) {
    void recordFailure({
      ...auditBase,
      action: "app.maintenance.update",
      description: "Failed to update app maintenance settings",
      reason: safeErrorMessage(error, "update_failed"),
    });
    return NextResponse.json(
      {
        ok: false,
        error: safeErrorMessage(error, "Failed to update settings."),
      },
      { status: 500 },
    );
  }
}
