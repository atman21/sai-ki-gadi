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
  allowlistAuditSnapshot,
  normalizeMaintenanceMobileE164,
} from "@/lib/app-maintenance-admin";

const SELECT = `
  id, mobile_number, normalized_mobile_number, is_active, description,
  created_at, updated_at, created_by, updated_by
`;

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(request: Request, context: Ctx) {
  const gate = await requireAdminPermission("app.manage", {
    request,
    auditModule: "app",
  });
  if (!gate.ok) return gate.response;

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json(
      { ok: false, error: "Missing id." },
      { status: 400 },
    );
  }

  const auditBase = {
    actor: gate.actor,
    module: "app",
    resourceType: "skg_app_maintenance_allowed_numbers",
    resourceId: id,
    ...clientMetaFromRequest(request),
  };

  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { ok: false, error: "Invalid payload." },
        { status: 400 },
      );
    }
    const payload = body as Record<string, unknown>;
    const patch: Record<string, unknown> = { updated_by: gate.actor.id };

    if (payload.mobile_number !== undefined) {
      const norm = normalizeMaintenanceMobileE164(payload.mobile_number);
      if (!norm.ok) {
        return NextResponse.json(
          { ok: false, error: norm.error },
          { status: 400 },
        );
      }
      patch.mobile_number = norm.display;
      patch.normalized_mobile_number = norm.e164;
    }
    if (payload.is_active !== undefined) {
      if (typeof payload.is_active !== "boolean") {
        return NextResponse.json(
          { ok: false, error: "is_active must be a boolean." },
          { status: 400 },
        );
      }
      patch.is_active = payload.is_active;
    }
    if (payload.description !== undefined) {
      if (payload.description === null || payload.description === "") {
        patch.description = null;
      } else if (typeof payload.description !== "string") {
        return NextResponse.json(
          { ok: false, error: "description must be a string." },
          { status: 400 },
        );
      } else {
        patch.description = payload.description.trim().slice(0, 300);
      }
    }

    const { data: before } = await gate.supabase
      .from("skg_app_maintenance_allowed_numbers")
      .select(SELECT)
      .eq("id", id)
      .maybeSingle();

    if (!before) {
      return NextResponse.json(
        { ok: false, error: "Allowlist entry not found." },
        { status: 404 },
      );
    }

    const { data, error } = await gate.supabase
      .from("skg_app_maintenance_allowed_numbers")
      .update(patch)
      .eq("id", id)
      .select(SELECT)
      .maybeSingle();

    if (error) {
      void recordFailure({
        ...auditBase,
        action: "app.maintenance.allowlist.update",
        description: "Failed to update allowlist entry",
        reason: error.message,
      });
      return NextResponse.json(
        {
          ok: false,
          error: safeErrorMessage(error, "Failed to update entry."),
        },
        { status: 500 },
      );
    }

    void recordChange({
      ...auditBase,
      action: "app.maintenance.allowlist.update",
      description: "Updated maintenance allowlist entry",
      beforeData: allowlistAuditSnapshot(
        before as Record<string, unknown>,
      ),
      afterData: allowlistAuditSnapshot(data as Record<string, unknown> | null),
    });

    return NextResponse.json({ ok: true, item: data });
  } catch (error) {
    void recordFailure({
      ...auditBase,
      action: "app.maintenance.allowlist.update",
      description: "Failed to update allowlist entry",
      reason: safeErrorMessage(error, "update_failed"),
    });
    return NextResponse.json(
      {
        ok: false,
        error: safeErrorMessage(error, "Failed to update entry."),
      },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request, context: Ctx) {
  const gate = await requireAdminPermission("app.manage", {
    request,
    auditModule: "app",
  });
  if (!gate.ok) return gate.response;

  const { id } = await context.params;
  const auditBase = {
    actor: gate.actor,
    module: "app",
    resourceType: "skg_app_maintenance_allowed_numbers",
    resourceId: id,
    ...clientMetaFromRequest(request),
  };

  try {
    const { data: before } = await gate.supabase
      .from("skg_app_maintenance_allowed_numbers")
      .select(SELECT)
      .eq("id", id)
      .maybeSingle();

    if (!before) {
      return NextResponse.json(
        { ok: false, error: "Allowlist entry not found." },
        { status: 404 },
      );
    }

    const { error } = await gate.supabase
      .from("skg_app_maintenance_allowed_numbers")
      .delete()
      .eq("id", id);

    if (error) {
      void recordFailure({
        ...auditBase,
        action: "app.maintenance.allowlist.delete",
        description: "Failed to delete allowlist entry",
        reason: error.message,
      });
      return NextResponse.json(
        {
          ok: false,
          error: safeErrorMessage(error, "Failed to delete entry."),
        },
        { status: 500 },
      );
    }

    void recordChange({
      ...auditBase,
      action: "app.maintenance.allowlist.delete",
      description: "Removed maintenance allowlist entry",
      beforeData: allowlistAuditSnapshot(
        before as Record<string, unknown>,
      ),
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    void recordFailure({
      ...auditBase,
      action: "app.maintenance.allowlist.delete",
      description: "Failed to delete allowlist entry",
      reason: safeErrorMessage(error, "delete_failed"),
    });
    return NextResponse.json(
      {
        ok: false,
        error: safeErrorMessage(error, "Failed to delete entry."),
      },
      { status: 500 },
    );
  }
}
