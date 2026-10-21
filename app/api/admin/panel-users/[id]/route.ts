import { NextResponse } from "next/server";

import { requireAdminPermission, safeErrorMessage } from "@/lib/admin-api";
import { writeAdminAuditLog, clientMetaFromRequest } from "@/lib/admin-audit";
import { hashAdminPassword } from "@/lib/admin-password";
import { countActiveSuperAdmins } from "@/lib/admin-rbac";

type Context = { params: Promise<{ id: string }> };

type PatchBody = {
  displayName?: string;
  password?: string;
  isActive?: boolean;
  isSuperAdmin?: boolean;
  roleIds?: string[];
  permissionOverrides?: { permissionKey: string; effect: "grant" | "deny" }[];
};

export async function GET(_request: Request, context: Context) {
  const gate = await requireAdminPermission("admins.view");
  if (!gate.ok) return gate.response;

  const { id } = await context.params;
  const { data, error } = await gate.supabase
    .from("admin_panel_users")
    .select(
      `
      id,
      username,
      display_name,
      is_active,
      is_super_admin,
      last_login_at,
      created_at,
      updated_at,
      admin_panel_user_roles!admin_panel_user_roles_user_id_fkey (
        role_id,
        admin_panel_roles!admin_panel_user_roles_role_id_fkey ( id, slug, name )
      ),
      admin_panel_user_permissions!admin_panel_user_permissions_user_id_fkey (
        permission_key,
        effect
      )
    `,
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { ok: false, error: safeErrorMessage(error, "Failed to load admin.") },
      { status: 400 },
    );
  }
  if (!data) {
    return NextResponse.json(
      { ok: false, error: "Admin user not found." },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true, data });
}

export async function PATCH(request: Request, context: Context) {
  const gate = await requireAdminPermission("admins.manage", {
    request,
    auditModule: "administration",
  });
  if (!gate.ok) return gate.response;

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as PatchBody;

  const { data: existing, error: loadErr } = await gate.supabase
    .from("admin_panel_users")
    .select("id, username, display_name, is_active, is_super_admin")
    .eq("id", id)
    .maybeSingle();

  if (loadErr || !existing) {
    return NextResponse.json(
      { ok: false, error: "Admin user not found." },
      { status: 404 },
    );
  }

  const updates: Record<string, unknown> = {};
  if (typeof body.displayName === "string" && body.displayName.trim()) {
    updates.display_name = body.displayName.trim();
  }
  if (typeof body.password === "string" && body.password.length > 0) {
    if (body.password.length < 8) {
      return NextResponse.json(
        { ok: false, error: "Password must be at least 8 characters." },
        { status: 400 },
      );
    }
    updates.password_hash = hashAdminPassword(body.password);
  }

  if (typeof body.isActive === "boolean") {
    if (
      existing.is_super_admin &&
      body.isActive === false
    ) {
      const activeSupers = await countActiveSuperAdmins();
      if (activeSupers <= 1) {
        return NextResponse.json(
          {
            ok: false,
            error: "Cannot deactivate the last active Super Admin.",
          },
          { status: 400 },
        );
      }
    }
    updates.is_active = body.isActive;
  }

  if (typeof body.isSuperAdmin === "boolean") {
    if (!gate.actor.isSuperAdmin) {
      return NextResponse.json(
        {
          ok: false,
          error: "Only a Super Admin can change Super Admin status.",
        },
        { status: 403 },
      );
    }
    if (existing.is_super_admin && body.isSuperAdmin === false) {
      const activeSupers = await countActiveSuperAdmins();
      if (activeSupers <= 1) {
        return NextResponse.json(
          {
            ok: false,
            error: "Cannot remove Super Admin from the last active Super Admin.",
          },
          { status: 400 },
        );
      }
    }
    updates.is_super_admin = body.isSuperAdmin;
  }

  if (Object.keys(updates).length > 0) {
    const { error } = await gate.supabase
      .from("admin_panel_users")
      .update(updates)
      .eq("id", id);
    if (error) {
      return NextResponse.json(
        {
          ok: false,
          error: safeErrorMessage(error, "Failed to update admin."),
        },
        { status: 400 },
      );
    }
  }

  // Role assignment requires permissions.assign (or Super Admin via admins.manage)
  if (Array.isArray(body.roleIds)) {
    const canAssign =
      gate.actor.isSuperAdmin ||
      gate.actor.permissions.has("permissions.assign");
    if (!canAssign) {
      return NextResponse.json(
        { ok: false, error: "Forbidden — cannot assign roles." },
        { status: 403 },
      );
    }
    await gate.supabase
      .from("admin_panel_user_roles")
      .delete()
      .eq("user_id", id);
    if (body.roleIds.length > 0) {
      await gate.supabase.from("admin_panel_user_roles").insert(
        body.roleIds.map((roleId) => ({
          user_id: id,
          role_id: roleId,
          assigned_by: gate.actor.id,
        })),
      );
    }
  }

  if (Array.isArray(body.permissionOverrides)) {
    const canAssign =
      gate.actor.isSuperAdmin ||
      gate.actor.permissions.has("permissions.assign");
    if (!canAssign) {
      return NextResponse.json(
        { ok: false, error: "Forbidden — cannot assign permissions." },
        { status: 403 },
      );
    }
    await gate.supabase
      .from("admin_panel_user_permissions")
      .delete()
      .eq("user_id", id);
    const rows = body.permissionOverrides.filter(
      (o) =>
        o.permissionKey &&
        (o.effect === "grant" || o.effect === "deny"),
    );
    if (rows.length > 0) {
      await gate.supabase.from("admin_panel_user_permissions").insert(
        rows.map((o) => ({
          user_id: id,
          permission_key: o.permissionKey,
          effect: o.effect,
          assigned_by: gate.actor.id,
        })),
      );
    }
  }

  void writeAdminAuditLog({
    actor: gate.actor,
    action: "admin_user_updated",
    module: "administration",
    description: `Updated admin user "${existing.username}"`,
    success: true,
    resourceType: "admin_panel_user",
    resourceId: id,
    beforeData: {
      displayName: existing.display_name,
      isActive: existing.is_active,
      isSuperAdmin: existing.is_super_admin,
    },
    afterData: {
      ...updates,
      password_hash: updates.password_hash ? "[redacted]" : undefined,
      roleIds: body.roleIds,
      permissionOverrides: body.permissionOverrides,
    },
    changedFields: Object.keys(updates),
    ...clientMetaFromRequest(request),
  });

  return NextResponse.json({ ok: true });
}
