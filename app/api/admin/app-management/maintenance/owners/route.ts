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
import { normalizeMaintenanceMobileE164 } from "@/lib/app-maintenance-admin";

/**
 * Owner/Admin bypass list — stores trusted public.users.id.
 * Admin adds by verified phone; server resolves users.phone → user_id.
 */
export async function GET(request: Request) {
  const gate = await requireAdminPermission("app.view", {
    request,
    auditModule: "app",
  });
  if (!gate.ok) return gate.response;

  try {
    const { data, error } = await gate.supabase
      .from("skg_app_maintenance_owner_users")
      .select("user_id, description, created_at, created_by")
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          error: safeErrorMessage(error, "Failed to load owner bypass list."),
        },
        { status: 500 },
      );
    }

    const ids = (data ?? []).map((r) => r.user_id);
    let phoneById: Record<string, string> = {};
    if (ids.length) {
      const { data: users } = await gate.supabase
        .from("users")
        .select("id, phone")
        .in("id", ids);
      phoneById = Object.fromEntries(
        (users ?? []).map((u) => [u.id as string, String(u.phone ?? "")]),
      );
    }

    return NextResponse.json({
      ok: true,
      items: (data ?? []).map((row) => ({
        ...row,
        phone: phoneById[row.user_id] ?? null,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: safeErrorMessage(error, "Failed to load owner bypass list."),
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const gate = await requireAdminPermission("app.manage", {
    request,
    auditModule: "app",
  });
  if (!gate.ok) return gate.response;

  const auditBase = {
    actor: gate.actor,
    module: "app",
    resourceType: "skg_app_maintenance_owner_users",
    resourceId: "new",
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
    const norm = normalizeMaintenanceMobileE164(payload.mobile_number);
    if (!norm.ok) {
      return NextResponse.json(
        { ok: false, error: norm.error },
        { status: 400 },
      );
    }

    const { data: user, error: userError } = await gate.supabase
      .from("users")
      .select("id, phone")
      .eq("phone", norm.e164)
      .maybeSingle();

    if (userError) {
      return NextResponse.json(
        {
          ok: false,
          error: safeErrorMessage(userError, "Failed to resolve member."),
        },
        { status: 500 },
      );
    }
    if (!user?.id) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "No member found with this verified phone. They must complete OTP login first.",
        },
        { status: 404 },
      );
    }

    const description =
      typeof payload.description === "string"
        ? payload.description.trim().slice(0, 300) || null
        : null;

    const { data, error } = await gate.supabase
      .from("skg_app_maintenance_owner_users")
      .insert({
        user_id: user.id,
        description,
        created_by: gate.actor.id,
      })
      .select("user_id, description, created_at, created_by")
      .maybeSingle();

    if (error) {
      const dup = /duplicate|unique/i.test(error.message);
      void recordFailure({
        ...auditBase,
        action: "app.maintenance.owners.create",
        description: "Failed to add owner bypass user",
        reason: error.message,
      });
      return NextResponse.json(
        {
          ok: false,
          error: dup
            ? "This member is already on the owner bypass list."
            : safeErrorMessage(error, "Failed to add owner."),
        },
        { status: dup ? 409 : 500 },
      );
    }

    void recordChange({
      ...auditBase,
      resourceId: String(user.id),
      action: "app.maintenance.owners.create",
      description: "Added owner bypass user for maintenance",
      afterData: {
        user_id: user.id,
        phone: norm.e164,
        has_description: Boolean(description),
      },
    });

    return NextResponse.json({
      ok: true,
      item: { ...data, phone: norm.e164 },
    });
  } catch (error) {
    void recordFailure({
      ...auditBase,
      action: "app.maintenance.owners.create",
      description: "Failed to add owner bypass user",
      reason: safeErrorMessage(error, "create_failed"),
    });
    return NextResponse.json(
      {
        ok: false,
        error: safeErrorMessage(error, "Failed to add owner."),
      },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  const gate = await requireAdminPermission("app.manage", {
    request,
    auditModule: "app",
  });
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const userId = url.searchParams.get("user_id");
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: "user_id is required." },
      { status: 400 },
    );
  }

  const auditBase = {
    actor: gate.actor,
    module: "app",
    resourceType: "skg_app_maintenance_owner_users",
    resourceId: userId,
    ...clientMetaFromRequest(request),
  };

  try {
    const { error } = await gate.supabase
      .from("skg_app_maintenance_owner_users")
      .delete()
      .eq("user_id", userId);

    if (error) {
      void recordFailure({
        ...auditBase,
        action: "app.maintenance.owners.delete",
        description: "Failed to remove owner bypass user",
        reason: error.message,
      });
      return NextResponse.json(
        {
          ok: false,
          error: safeErrorMessage(error, "Failed to remove owner."),
        },
        { status: 500 },
      );
    }

    void recordChange({
      ...auditBase,
      action: "app.maintenance.owners.delete",
      description: "Removed owner bypass user",
      beforeData: { user_id: userId },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    void recordFailure({
      ...auditBase,
      action: "app.maintenance.owners.delete",
      description: "Failed to remove owner bypass user",
      reason: safeErrorMessage(error, "delete_failed"),
    });
    return NextResponse.json(
      {
        ok: false,
        error: safeErrorMessage(error, "Failed to remove owner."),
      },
      { status: 500 },
    );
  }
}
